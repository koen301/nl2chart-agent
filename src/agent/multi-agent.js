import axios from 'axios';
import { AgentTools } from './tools.js';

const PLANNER_PROMPT = `你是一个任务规划 Agent，负责将用户需求分解为可执行的步骤。

你的职责：
1. 理解用户想要什么（分析数据、可视化、导出等）
2. 规划执行步骤顺序
3. 确定需要使用哪些工具

可用工具：
- querySalesData: 查询内置销售数据（按地区、产品、时间筛选）
- queryUploadedData: 查询用户上传的数据文件
- calculateStatistics: 计算统计指标（总和、平均值、最大最小值）
- generateChartConfig: 生成图表配置（柱状图、折线图、饼图、散点图、雷达图、热力图、仪表盘、环形图）
- exportData: 导出数据为 JSON

执行步骤原则：
1. 先查询数据，再统计分析，最后生成图表
2. 图表必须基于真实查询结果
3. 每一步都要有明确目的

输出格式：
必须返回以下 JSON 格式的执行计划，不要添加任何其他内容：
{
  "steps": [
    {"order": 1, "tool": "工具名", "reason": "为什么调用这个工具"},
    {"order": 2, "tool": "工具名", "reason": "为什么调用这个工具"}
  ],
  "finalAction": "最终应该生成什么（图表类型/数据导出/文字总结）"
}`;

const EXECUTOR_PROMPT = `你是一个执行 Agent，负责根据计划调用具体的工具。

你将收到：
1. 当前要执行的步骤
2. 之前步骤的执行结果

你的职责：
1. 提取步骤中需要传递的参数
2. 生成正确的工具调用参数
3. 根据之前的执行结果调整下一步

数据来源：
- 内置销售数据库（地区：华东/华北/华南/西南；产品：笔记本电脑/手机/平板电脑）
- 用户上传的 CSV/Excel 数据文件（通过 queryUploadedData 查询）

工具参数生成规则：
- querySalesData: 地区、产品、日期范围可选，groupBy 必填（region/product/month/none）
- queryUploadedData: action 必填（list/query/info）
- calculateStatistics: metric（sales_amount/quantity）和 operation（sum/avg/max/min/count）必填
- generateChartConfig: type、title、labels、values 必填；多系列用二维数组

输出格式：
返回 JSON 格式的工具调用参数：
{"tool": "工具名", "args": {"参数名": "参数值"}}`;

const REVIEWER_PROMPT = `你是一个审查 Agent，负责判断当前执行结果是否满足用户需求。

你将收到：
1. 用户的原始需求
2. 已执行的步骤和结果
3. 图表配置（如果有）

你的职责：
1. 检查是否已获取足够的数据
2. 检查图表配置是否正确反映了用户需求
3. 判断任务是否完成，还是需要继续执行

判断标准：
- 用户要求饼图/环形图，是否生成了正确的图表类型？
- 用户要求分析上传文件，是否查询了正确的文件？
- 数据是否足够支撑用户的分析需求？
- 是否有任何明显的错误或遗漏？

输出格式：
返回 JSON 格式的审查结果：
{
  "status": "complete" | "incomplete" | "failed",
  "reason": "审查理由",
  "nextStep": "建议的下一步（如果有）",
  "issues": ["发现的问题列表（如果有）"]
}`;

class MultiAgent {
  constructor(apiUrl, apiKey, model, db) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.tools = new AgentTools(db);
    this.maxSteps = 6;
  }

  async callLLM(messages, tools = null, temperature = 0.2) {
    const requestData = {
      model: this.model,
      messages: messages,
      temperature: temperature
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

  async *executeStream(userInput) {
    console.log('\n=== 多 Agent 协作开始 ===');
    console.log('用户需求:', userInput);

    const toolsModule = await import('./tools.js');
    const tools = Object.values(toolsModule.toolSchemas).map(schema => ({
      type: 'function',
      function: schema
    }));

    let executionHistory = [];
    let chartConfig = null;
    let finalResponse = '';

    yield {
      event: 'agent',
      data: { type: 'planner', message: '开始规划任务...' }
    };

    let plan = null;
    try {
      const plannerMessages = [
        { role: 'system', content: PLANNER_PROMPT },
        { role: 'user', content: `用户需求：${userInput}` }
      ];

      const planResponse = await this.callLLM(plannerMessages);
      console.log('Planner 响应:', planResponse.content);

      yield {
        event: 'agent',
        data: { type: 'planner', message: '规划完成，开始执行...' }
      };

      plan = JSON.parse(planResponse.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
    } catch (error) {
      console.error('Planner 错误:', error.message);
      yield {
        event: 'error',
        data: { type: 'error', error: `规划失败: ${error.message}` }
      };
      return;
    }

    let currentStepIndex = 0;
    let consecutiveNoProgress = 0;

    while (currentStepIndex < this.maxSteps) {
      console.log(`\n--- 第 ${currentStepIndex + 1} 步 ---`);

      yield {
        event: 'step',
        data: { type: 'step_start', step: currentStepIndex + 1 }
      };

      if (currentStepIndex < plan.steps.length) {
        const step = plan.steps[currentStepIndex];
        yield {
          event: 'agent',
          data: { type: 'executor', message: `执行: ${step.tool}` }
        };

        const executorMessages = [
          { role: 'system', content: EXECUTOR_PROMPT },
          { role: 'user', content: JSON.stringify({ step, history: executionHistory }) }
        ];

        try {
          const executorResponse = await this.callLLM(executorMessages, tools);
          const executorResult = JSON.parse(
            executorResponse.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
          );

          const toolName = executorResult.tool;
          const args = executorResult.args;

          console.log(`调用工具: ${toolName}`, args);

          yield {
            event: 'tool_call',
            data: { type: 'tool_call', tool: toolName, args: args }
          };

          let result;
          if (this.tools[toolName]) {
            result = await this.tools[toolName](args);
          } else {
            result = { success: false, error: `未知工具: ${toolName}` };
          }

          console.log('工具返回:', JSON.stringify(result).substring(0, 200));

          yield {
            event: 'tool_result',
            data: {
              type: 'tool_result',
              tool: toolName,
              result: { success: result.success, summary: this.summarizeResult(result) }
            }
          };

          if (result.config) {
            chartConfig = result.config;
          }

          executionHistory.push({
            step: currentStepIndex + 1,
            tool: toolName,
            args: args,
            result: result
          });

          if (!result.success) {
            consecutiveNoProgress++;
          } else {
            consecutiveNoProgress = 0;
          }

        } catch (error) {
          console.error('Executor 错误:', error.message);
          yield {
            event: 'error',
            data: { type: 'error', error: `执行失败: ${error.message}` }
          };
          currentStepIndex++;
          continue;
        }
      }

      yield {
        event: 'agent',
        data: { type: 'reviewer', message: '审查结果...' }
      };

      try {
        const reviewMessages = [
          { role: 'system', content: REVIEWER_PROMPT },
          { role: 'user', content: JSON.stringify({ userInput, history: executionHistory, chartConfig }) }
        ];

        const reviewResponse = await this.callLLM(reviewMessages);
        const review = JSON.parse(
          reviewResponse.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        );

        console.log('Reviewer 审查:', review.status, review.reason);

        yield {
          event: 'agent',
          data: { type: 'reviewer', message: review.reason }
        };

        if (review.status === 'complete') {
          finalResponse = review.reason;
          break;
        } else if (review.status === 'failed') {
          yield {
            event: 'error',
            data: { type: 'error', error: review.reason }
          };
          break;
        } else if (review.issues && review.issues.length > 0) {
          if (currentStepIndex >= plan.steps.length) {
            plan.steps.push({ order: currentStepIndex + 1, tool: review.nextStep, reason: review.issues[0] });
          }
        }

      } catch (error) {
        console.error('Reviewer 错误:', error.message);
      }

      currentStepIndex++;

      if (consecutiveNoProgress >= 3) {
        console.log('\n=== 连续多次无进展，终止执行 ===');
        break;
      }
    }

    if (currentStepIndex >= this.maxSteps) {
      console.log('\n=== 达到最大执行步数 ===');
      yield {
        event: 'complete',
        data: {
          type: 'max_steps_reached',
          content: '已达到最大执行步数',
          chartConfig: chartConfig
        }
      };
      return;
    }

    yield {
      event: 'complete',
      data: {
        type: 'final_response',
        content: finalResponse || '任务完成',
        chartConfig: chartConfig
      }
    };
  }

  summarizeResult(result) {
    if (!result.success) return '执行失败';
    if (result.data && result.data.length > 0) return `获取到 ${result.count} 条数据`;
    if (result.value !== undefined) return `计算结果: ${result.value}`;
    if (result.config) return `生成 ${result.config.type} 图: ${result.config.title}`;
    return '执行成功';
  }
}

export { MultiAgent, PLANNER_PROMPT, EXECUTOR_PROMPT, REVIEWER_PROMPT };