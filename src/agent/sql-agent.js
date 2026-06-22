/**
 * SQL Agent（直接生成 SQL + 安全过滤）
 *
 * 改造后：streamText + Zod 工具 + 完整 SSE 事件
 * 保留：HTTP 网关优先 + 本地回退、schema 走网关、不直接连 DB
 *
 * 与 SQL 网关的关系：
 * - SQL 执行  → POST /api/sql/query
 * - Schema 获取 → GET  /api/sql/schema
 * - Agent 不直接连 DB；网关是唯一数据通道
 */

import { tool } from 'ai';
import { z } from 'zod';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { streamText, stepCountIs } from 'ai';
import { createChatModel } from './llm.js';
import { createEngine } from '../engines/index.js';
import { getSchema, getSchemaSync, schemaToText } from '../engines/json-engine.js';

function buildSqlTools(db, gatewayConfig, sqlEngine) {
  const { gatewayQueryUrl, gatewayEnabled } = gatewayConfig;

  return {
    executeSql: tool({
      description: '执行 SELECT SQL 查询并返回结果。自动应用安全过滤：禁止 DROP/DELETE/UPDATE/INSERT 等修改操作，禁止访问系统表。',
      inputSchema: z.object({
        sql: z.string().describe('要执行的 SQL SELECT 语句'),
        description: z.string().optional().describe('对这条 SQL 的简要说明'),
        maxRows: z.number().optional().describe('限制返回行数')
      }),
      execute: async (args) => {
        if (gatewayEnabled) {
          try {
            const res = await axios.post(
              gatewayQueryUrl,
              { sql: args.sql, maxRows: args.maxRows },
              { timeout: 15000, validateStatus: () => true }
            );
            if (res.status === 200 && res.data && res.data.success !== false) {
              return {
                success: true,
                data: res.data.data || [],
                count: res.data.count,
                truncated: res.data.truncated,
                duration: res.data.duration,
                viaGateway: true
              };
            }
            return {
              success: false,
              error: res.data?.error || `网关返回 ${res.status}`,
              reason: res.data?.reason,
              code: res.data?.code
            };
          } catch (e) {
            console.warn(`[SQL Gateway] 调用失败，回退到本地引擎: ${e.message}`);
            return await sqlEngine.execute(args.sql);
          }
        }
        return await sqlEngine.execute(args.sql);
      }
    }),

    generateChartConfig: tool({
      description: '根据查询结果生成图表配置。支持：bar(柱状图)、line(折线图)、pie(饼图)、doughnut(环形图)、scatter(散点图)、radar(雷达图)、heatmap(热力图)、gauge(仪表盘)',
      inputSchema: z.object({
        type: z.enum(['bar', 'line', 'pie', 'doughnut', 'scatter', 'radar', 'heatmap', 'gauge']),
        title: z.string(),
        labels: z.array(z.string()),
        values: z.array(z.union([z.number(), z.array(z.number())]))
      }),
      execute: async (args) => {
        const config = {
          id: uuidv4(),
          ...args,
          createdAt: new Date().toISOString()
        };
        return { success: true, config };
      }
    }),

    exportData: tool({
      description: '导出数据为 JSON 格式',
      inputSchema: z.object({
        format: z.literal('json'),
        limit: z.number().optional()
      }),
      execute: async (args) => ({ success: true, format: args.format, count: 0, data: [] })
    })
  };
}

class SqlAgent {
  /**
   * @param {string|object} apiUrlOrEnv - 兼容老调用
   * @param {string} [apiKey]
   * @param {string} [model]
   * @param {object} [db]
   * @param {object} [gatewayConfig]
   */
  constructor(apiUrlOrEnv, apiKey, model, db, gatewayConfig = {}) {
    if (typeof apiUrlOrEnv === 'string') {
      this.env = { apiUrl: apiUrlOrEnv, apiKey, model };
      this.db = db;
      this.gatewayConfig = gatewayConfig;
    } else {
      this.env = apiUrlOrEnv;
      this.db = apiKey;
      this.gatewayConfig = model || gatewayConfig || {};
    }

    this.model = createChatModel(this.env);
    const base = this.gatewayConfig.gatewayUrl || `http://127.0.0.1:${process.env.PORT || 3000}`;
    this.gatewayConfig.gatewayQueryUrl = this.gatewayConfig.gatewayQueryUrl || `${base}/api/sql/query`;
    this.gatewayConfig.gatewaySchemaUrl = this.gatewayConfig.gatewaySchemaUrl || `${base}/api/sql/schema`;
    if (this.gatewayConfig.gatewayEnabled === undefined) {
      this.gatewayConfig.gatewayEnabled = true;
    }
    this.sqlEngine = createEngine(this.db);
    this.tools = buildSqlTools(this.db, this.gatewayConfig, this.sqlEngine);
    this.maxSteps = 5;
    this.cachedSchema = null;
  }

  /**
   * 走网关拿 schema（元数据通道）；失败回退本地
   */
  async resolveSchema() {
    if (this.cachedSchema) return this.cachedSchema;
    const { gatewayEnabled, gatewaySchemaUrl } = this.gatewayConfig;

    if (gatewayEnabled) {
      try {
        const res = await axios.get(gatewaySchemaUrl, { timeout: 10000 });
        if (res.data && res.data.success) {
          this.cachedSchema = res.data.schema;
          return this.cachedSchema;
        }
      } catch (e) {
        console.warn('[SqlAgent] 网关获取 schema 失败，回退本地:', e.message);
      }
    }

    const pool = this.db && this.db.pool ? this.db.pool : null;
    const datasets = (global.uploadedDatasets && Object.keys(global.uploadedDatasets).length > 0)
      ? Object.values(global.uploadedDatasets)
      : [];
    try {
      this.cachedSchema = await getSchema({ pool, datasets, preferDynamic: true });
    } catch (e) {
      this.cachedSchema = getSchemaSync({ datasets });
    }
    return this.cachedSchema;
  }

  refreshSchema() {
    this.cachedSchema = null;
  }

  async buildSystemPrompt() {
    const schema = await this.resolveSchema();
    const { gatewayEnabled, gatewaySchemaUrl } = this.gatewayConfig;

    // 网关返回 text 通道优先
    let schemaText = '';
    if (gatewayEnabled) {
      try {
        const res = await axios.get(`${gatewaySchemaUrl}?format=text`, { timeout: 10000 });
        if (res.data && res.data.success) {
          schemaText = res.data.text || '';
        }
      } catch (e) { /* fall through */ }
    }
    if (!schemaText) {
      schemaText = schemaToText(schema);
    }

    const dbInfo = schema && schema.database ? `数据库: ${schema.database}` : '';
    const tableNames = (schema && schema.tables || []).map(t => t.name).join(', ');

    return `你是一个 SQL 数据分析 Agent，根据用户的自然语言需求，生成 SQL 查询并执行。

${schemaText}

工作流程：
1. 理解用户的数据分析需求
2. 生成对应的 SQL SELECT 语句（表名: ${tableNames || '见上文'}）
3. 调用 executeSql 工具执行 SQL
4. 根据查询结果生成图表配置（generateChartConfig）
5. 给用户返回分析结论

SQL 生成规则：
- 只生成 SELECT 查询，禁止任何修改/删除操作
- 字段名、表名严格使用 schema 中的定义
- 字符串值用单引号
- 日期格式 'YYYY-MM-DD'
- 使用合适的聚合函数：COUNT/SUM/AVG/MAX/MIN
- 适当使用 GROUP BY 和 ORDER BY 提升查询性能

工具：
- executeSql: 执行 SQL 查询
- generateChartConfig: 生成图表配置
- exportData: 导出数据

重要规则：
- executeSql 失败时，应基于已有结果调整 SQL，最多重试 2-3 次
- 查询成功后必须调 generateChartConfig 生成图表配置
- 最后一步必然要调 generateChartConfig（即使数据不够理想也要给出 best-effort 图表）`;
  }

  async *executeStream(userInput) {
    console.log('\n=== SQL Agent 流式执行开始 ===');
    console.log('用户需求:', userInput);

    const systemPrompt = await this.buildSystemPrompt();

    const result = streamText({
      model: this.model,
      system: systemPrompt,
      messages: [{ role: 'user', content: userInput }],
      tools: this.tools,
      stopWhen: stepCountIs(this.maxSteps),
      temperature: 0.2,
    });

    let chartConfig = null;
    let stepCounter = 0;
    let finalText = '';

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'start-step':
        case 'step-start': {
          stepCounter++;
          yield {
            event: 'step',
            data: { type: 'step_start', step: stepCounter, message: `正在执行第 ${stepCounter} 步...` }
          };
          break;
        }
        case 'text-delta': {
          const content = part.textDelta ?? part.text ?? '';
          finalText += content;
          yield { event: 'message', data: { type: 'content', content, step: stepCounter } };
          break;
        }
        case 'tool-call': {
          // ai@4: part.args  ai@5: part.input
          let args = part.input ?? (typeof part.args === 'string' ? safeJSON(part.args) : part.args);
          if (args === undefined || args === null) args = {};
          yield {
            event: 'tool_call',
            data: { type: 'tool_call', tool: part.toolName, args, step: stepCounter }
          };
          break;
        }
        case 'tool-result': {
          const r = part.result ?? part.output;
          if (r && r.config) chartConfig = r.config;
          yield {
            event: 'tool_result',
            data: {
              type: 'tool_result',
              tool: part.toolName,
              result: {
                success: r?.success,
                count: r?.count,
                summary: this.summarizeResult(r)
              },
              step: stepCounter
            }
          };
          break;
        }
        case 'finish-step':
        case 'step-finish':
          break;
        case 'finish':
        case 'done': {
          yield {
            event: 'complete',
            data: { type: 'final_response', content: finalText, chartConfig }
          };
          return;
        }
        case 'error': {
          console.error('SQL Agent 错误:', part.error);
          yield { event: 'error', data: { type: 'error', error: String(part.error?.message ?? part.error) } };
          return;
        }
        default:
          break;
      }
    }

    // 流自然结束（无 finish 事件兜底）
    yield {
      event: 'complete',
      data: { type: 'final_response', content: finalText, chartConfig }
    };
  }

  summarizeResult(result) {
    if (!result) return '无结果';
    if (!result.success) return `执行失败: ${result.error}`;
    if (result.data && result.data.length > 0) return `获取到 ${result.count} 条数据`;
    if (result.config) return `生成 ${result.config.type} 图: ${result.config.title}`;
    return '执行成功';
  }
}

function safeJSON(s) {
  try { return JSON.parse(s); } catch { return s; }
}

export { SqlAgent };
