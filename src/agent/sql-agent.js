import axios from 'axios';
import { createSqlEngine, schemaToText } from './sql-engine.js';

class SqlAgent {
  constructor(apiUrl, apiKey, model, db) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.sqlEngine = createSqlEngine(db);
    this.maxSteps = 5;
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

  buildSystemPrompt() {
    return `你是一个 SQL 数据分析 Agent，根据用户的自然语言需求，生成 SQL 查询并执行。

${schemaToText()}

工作流程：
1. 理解用户的数据分析需求
2. 生成对应的 SQL SELECT 语句
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
            result = await this.sqlEngine.execute(args.sql);
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

  summarizeResult(result) {
    if (!result.success) return `执行失败: ${result.error}`;
    if (result.data && result.data.length > 0) return `获取到 ${result.count} 条数据`;
    if (result.config) return `生成 ${result.config.type} 图: ${result.config.title}`;
    return '执行成功';
  }
}

export { SqlAgent };