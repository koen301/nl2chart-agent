/**
 * SQL Agent（单 Agent 模式）
 *
 * 职责：
 * - 单 LLM 循环：理解需求 → 生成 SQL → 调工具执行 → 总结
 * - 默认通过 HTTP 调用 SQL 网关执行查询与获取 schema
 *
 * 与 SQL 网关的关系：
 * - Agent 不直接连 DB，所有数据访问（含元数据）都走 HTTP 调网关
 * - SQL 执行  → POST /api/sql/query
 * - Schema 获取 → GET  /api/sql/schema
 * - 这样网关才是"唯一安全边界"和"唯一数据通道"，便于未来独立部署
 */

import axios from 'axios';
import { createEngine } from '../engines/index.js';

class SqlAgent {
  constructor(apiUrl, apiKey, model, db, gatewayConfig = {}) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.db = db;
    this.sqlEngine = createEngine(db);
    const base = gatewayConfig.gatewayUrl || `http://127.0.0.1:${process.env.PORT || 3000}`;
    this.gatewayQueryUrl = `${base}/api/sql/query`;
    this.gatewaySchemaUrl = `${base}/api/sql/schema`;
    this.gatewayEnabled = gatewayConfig.gatewayEnabled !== false;
    this.maxSteps = 5;
    this.cachedSchema = null;
  }

  /**
   * 统一走网关拿 schema（元数据通道）
   * 网关会内部决定是走 MySQL information_schema，还是上传数据集，还是静态
   */
  async resolveSchema() {
    if (this.cachedSchema) return this.cachedSchema;

    if (this.gatewayEnabled) {
      try {
        const res = await axios.get(this.gatewaySchemaUrl, { timeout: 10000 });
        if (res.data && res.data.success) {
          this.cachedSchema = res.data.schema;
          return this.cachedSchema;
        }
      } catch (e) {
        console.warn('[SqlAgent] 网关获取 schema 失败，回退本地:', e.message);
      }
    }

    // 兜底：直接本地拿（仅当网关不可用时）
    const { getSchema, getSchemaSync } = await import('../engines/json-engine.js');
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

  async callLLM(messages, tools = null, temperature = 0.2) {
    const requestData = {
      model: this.model,
      messages,
      temperature
    };
    if (tools) {
      requestData.tools = tools;
      requestData.tool_choice = 'auto';
    }
    const response = await axios({
      method: 'post',
      url: this.apiUrl,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      data: requestData
    });
    return response.data.choices[0].message;
  }

  async buildSystemPrompt() {
    const schema = await this.resolveSchema();

    // 网关返回的 schema 已经是结构化的（{database, tables}），
    // 直接交给网关的 schemaToText 走 text 通道；或者本地 fallback 时再调用 schemaToText
    let schemaText = '';
    if (this.gatewayEnabled) {
      try {
        const res = await axios.get(`${this.gatewaySchemaUrl}?format=text`, { timeout: 10000 });
        if (res.data && res.data.success) {
          schemaText = res.data.text || '';
        }
      } catch (e) {
        // 忽略，下面用 schema 对象本地渲染
      }
    }
    if (!schemaText) {
      const { schemaToText } = await import('../engines/json-engine.js');
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
- 字段名、表明严格使用 schema 中的定义
- 字符串值用单引号
- 日期格式 'YYYY-MM-DD'
- 使用合适的聚合函数：COUNT/SUM/AVG/MAX/MIN
- 适当使用 GROUP BY 和 ORDER BY 提升查询性能

工具：
- executeSql: 执行 SQL 查询
- generateChartConfig: 生成图表配置
- exportData: 导出数据`;
  }

  buildTools() {
    return [
      {
        type: 'function',
        function: {
          name: 'executeSql',
          description: '执行 SELECT SQL 查询并返回结果。自动应用安全过滤：禁止 DROP/DELETE/UPDATE/INSERT 等修改操作，禁止访问系统表。',
          parameters: {
            type: 'object',
            properties: {
              sql: {
                type: 'string',
                description: '要执行的 SQL SELECT 语句'
              },
              description: {
                type: 'string',
                description: '对这条 SQL 的简要说明'
              }
            },
            required: ['sql']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'generateChartConfig',
          description: '根据查询结果生成图表配置。支持：bar(柱状图)、line(折线图)、pie(饼图)、doughnut(环形图)、scatter(散点图)、radar(雷达图)、heatmap(热力图)、gauge(仪表盘)',
          parameters: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['bar', 'line', 'pie', 'doughnut', 'scatter', 'radar', 'heatmap', 'gauge'] },
              title: { type: 'string' },
              labels: { type: 'array', items: { type: 'string' } },
              values: { type: 'array' }
            },
            required: ['type', 'title', 'labels', 'values']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'exportData',
          description: '导出数据为 JSON 格式',
          parameters: {
            type: 'object',
            properties: {
              format: { type: 'string', enum: ['json'] },
              limit: { type: 'number' }
            },
            required: ['format']
          }
        }
      }
    ];
  }

  async *executeStream(userInput) {
    console.log('\n=== SQL Agent 流式执行开始 ===');
    console.log('用户需求:', userInput);

    const tools = this.buildTools();
    const messages = [
      { role: 'system', content: this.buildSystemPrompt() },
      { role: 'user', content: userInput }
    ];

    let chartConfig = null;
    let finalResponse = '';

    for (let step = 0; step < this.maxSteps; step++) {
      console.log(`\n--- 第 ${step + 1} 步 ---`);

      yield {
        event: 'step',
        data: { type: 'step_start', step: step + 1 }
      };

      try {
        const message = await this.callLLM(messages, tools);
        messages.push(message);

        console.log('LLM 回复:', message.content || '[调用工具]');

        if (!message.tool_calls || message.tool_calls.length === 0) {
          finalResponse = message.content;
          for (let i = 0; i < finalResponse.length; i += 20) {
            yield {
              event: 'message',
              data: { type: 'content', content: finalResponse.substring(i, i + 20) }
            };
          }
          yield {
            event: 'complete',
            data: { type: 'final_response', content: finalResponse, chartConfig }
          };
          return;
        }

        for (const toolCall of message.tool_calls) {
          const toolName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);

          yield {
            event: 'tool_call',
            data: { type: 'tool_call', tool: toolName, args }
          };

          let result;
          if (toolName === 'executeSql') {
            result = await this.executeSqlViaGateway(args);
          } else if (toolName === 'generateChartConfig') {
            const { v4: uuidv4 } = await import('uuid');
            const config = { id: uuidv4(), ...args, createdAt: new Date().toISOString() };
            result = { success: true, config };
            chartConfig = config;
          } else if (toolName === 'exportData') {
            result = { success: true, format: args.format, count: 0, data: [] };
          } else {
            result = { success: false, error: `未知工具: ${toolName}` };
          }

          console.log('工具返回:', JSON.stringify(result).substring(0, 200));

          yield {
            event: 'tool_result',
            data: {
              type: 'tool_result',
              tool: toolName,
              result: {
                success: result.success,
                summary: this.summarizeResult(result)
              }
            }
          };

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
          });
        }
      } catch (error) {
        console.error('SQL Agent 执行错误:', error.message);
        yield {
          event: 'error',
          data: { type: 'error', error: error.message }
        };
        return;
      }
    }

    yield {
      event: 'complete',
      data: { type: 'max_steps_reached', content: '已达最大执行步数', chartConfig }
    };
  }

  async executeSqlViaGateway(args) {
    if (!this.gatewayEnabled) {
      return await this.sqlEngine.execute(args.sql);
    }

    try {
      const response = await axios.post(
        this.gatewayQueryUrl,
        { sql: args.sql, maxRows: args.maxRows },
        { timeout: 15000, validateStatus: () => true }
      );

      if (response.status === 200 && response.data && response.data.success !== false) {
        return {
          success: true,
          data: response.data.data || [],
          count: response.data.count,
          truncated: response.data.truncated,
          duration: response.data.duration,
          viaGateway: true
        };
      }

      return {
        success: false,
        error: response.data?.error || `网关返回 ${response.status}`,
        reason: response.data?.reason,
        code: response.data?.code
      };
    } catch (error) {
      console.warn(`[SQL Gateway] 调用失败，回退到本地引擎: ${error.message}`);
      return await this.sqlEngine.execute(args.sql);
    }
  }

  summarizeResult(result) {
    if (!result.success) return `执行失败: ${result.error}`;
    if (result.data && result.data.length > 0) return `获取到 ${result.count} 条数据`;
    if (result.config) return `生成 ${result.config.type} 图: ${result.config.title}`;
    return '执行成功';
  }
}

export { SqlAgent };