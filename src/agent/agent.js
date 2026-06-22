/**
 * Data Agent（单 Agent 模式）
 *
 * 改造后：使用 Vercel AI SDK 4.x 的 streamText
 * 保留：与 SQL 网关关系、所有 SSE 事件协议（前端零改动）
 *
 * 关键变化：
 * - 删除 axios.post(API_URL, ...) 手写循环
 * - 改用 streamText + fullStream 事件桥接
 * - 工具 schema 用 zod（buildTools(db)）
 * - LLM 调用由 llm.js 统一封装
 */

import { streamText, stepCountIs } from 'ai';
import { createChatModel } from './llm.js';
import { buildTools } from './tools.js';

const DATA_AGENT_PROMPT = `你是一个智能数据分析 Agent，拥有多种工具帮助用户分析和可视化数据。

执行流程：
1. 分析用户需求，理解用户想看什么数据
2. 选择合适的工具查询数据（querySalesData）
3. 根据需要进行统计分析（calculateStatistics）
4. 生成可视化图表配置（generateChartConfig）
5. 如果需要，导出数据（exportData）

重要规则：
- 先查询数据，再生成图表
- 图表必须基于真实查询结果
- 如果用户需求模糊，合理推断并说明
- 最后输出总结性文字给用户`;

class DataAgent {
  /**
   * @param {string|object} apiUrlOrEnv - 兼容老调用：传 apiUrl 字符串；新调用：传 env 对象
   * @param {string} [apiKey]
   * @param {string} [model]
   * @param {object} [db]
   */
  constructor(apiUrlOrEnv, apiKey, model, db) {
    // 兼容老签名 new DataAgent(apiUrl, apiKey, model, db)
    if (typeof apiUrlOrEnv === 'string') {
      this.env = { apiUrl: apiUrlOrEnv, apiKey, model };
      this.db = db;
    } else {
      this.env = apiUrlOrEnv;
      this.db = apiKey;     // 兼容 new DataAgent(env, db)
    }

    this.model = createChatModel(this.env);
    this.tools = buildTools(this.db);
    this.maxSteps = 5;
  }

  async *executeStream(userInput) {
    console.log('\n=== Agent 流式执行开始 ===');
    console.log('用户需求:', userInput);

    let chartConfig = null;
    let stepCounter = 0;
    let finalText = '';

    let result;
    try {
      result = streamText({
        model: this.model,
        system: DATA_AGENT_PROMPT,
        messages: [{ role: 'user', content: userInput }],
        tools: this.tools,
        stopWhen: stepCountIs(this.maxSteps),     // ai@5: 用 stopWhen 驱动多步
        temperature: 0.2,
      });
    } catch (error) {
      console.error('Agent 初始化错误:', error.message);
      yield { event: 'error', data: { type: 'error', error: error.message } };
      return;
    }

    try {
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'start-step':
          case 'step-start': {                       // 兼容旧版事件名
            stepCounter++;
            yield {
              event: 'step',
              data: {
                type: 'step_start',
                step: stepCounter,
                message: `正在执行第 ${stepCounter} 步...`
              }
            };
            break;
          }

          case 'text-delta': {
            // v4: part.textDelta  v5: part.text  都兼容
            const content = part.textDelta ?? part.text ?? '';
            finalText += content;
            yield {
              event: 'message',
              data: { type: 'content', content, step: stepCounter, isEnd: false }
            };
            break;
          }

          case 'tool-input-start':
          case 'tool-input-delta':
            // 工具参数流式增量：暂时忽略，聚合到 tool-call
            break;

          case 'tool-call': {
            // ai@4: part.args  ai@5: part.input
            let args = part.input ?? (typeof part.args === 'string' ? safeJSON(part.args) : part.args);
            if (args === undefined || args === null) args = {};
            yield {
              event: 'tool_call',
              data: {
                type: 'tool_call',
                tool: part.toolName,
                args,
                step: stepCounter
              }
            };
            break;
          }

          case 'tool-result': {
            // ai@4: part.result  ai@5: part.output
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
            // 一步完成：不发事件（避免和 start-step 重复）
            break;

          case 'error': {
            const err = part.error;
            const msg = err?.message || (typeof err === 'string' ? err : JSON.stringify(err));
            console.error('Agent 执行错误:', msg);
            yield { event: 'error', data: { type: 'error', error: msg } };
            return;
          }

          case 'finish':
            // 流结束：跳到下方 yield complete
            break;

          default:
            // 忽略未识别事件
            break;
        }
      }
    } catch (error) {
      console.error('Agent 执行错误:', error.message);
      yield { event: 'error', data: { type: 'error', error: error.message } };
      return;
    }

    yield {
      event: 'complete',
      data: {
        type: 'final_response',
        content: finalText || '执行完成',
        chartConfig
      }
    };
  }

  summarizeResult(result) {
    if (!result) return '无结果';
    if (!result.success) return '执行失败';
    if (result.config) return `生成 ${result.config.type} 图: ${result.config.title}`;
    if (result.data && result.data.length > 0) return `获取到 ${result.count} 条数据`;
    if (result.value !== undefined) return `计算结果: ${result.value}`;
    if (result.datasets) return `找到 ${result.datasets.length} 个数据集`;
    if (result.dataset) return `数据集 ${result.dataset.name} 共 ${result.dataset.rowCount} 条`;
    return '执行成功';
  }
}

function safeParseJSON(s) {
  try { return JSON.parse(s); } catch { return s; }
}

export { DataAgent };
