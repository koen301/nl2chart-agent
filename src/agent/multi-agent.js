/**
 * Multi Agent（多 Agent 协作模式）
 *
 * 改造后：Planner/Reviewer 用 generateText；Executor 用 streamText
 * 保留：三段式骨架、SSE 事件协议、工具调用能力
 *
 * 与 SQL 网关的关系：
 * - Executor 通过 buildTools(db) 走 AgentTools（间接走网关）
 * - Planner/Reviewer 不直接连 DB
 */

import { streamText, generateText, stepCountIs } from 'ai';
import { createChatModel } from './llm.js';
import { buildTools } from './tools.js';

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
    {"order": 1, "tool": "工具名", "reason": "为什么调用这个工具", "dangerous": false}
  ],
  "finalAction": "最终应该生成什么（图表类型/数据导出/文字总结）"
}

dangerous 标记规则：
- 大多数查询/统计/图表步骤 dangerous = false（默认）
- 当用户请求中包含"删除/修改/写入/导出敏感数据"等动作时，相应步骤必须标 dangerous = true
- 不确定时标 false（不打扰用户）
}`;

const EXECUTOR_PROMPT = `你是一个执行 Agent，负责根据计划调用具体的工具。

你将收到：
1. 当前要执行的步骤（来自 Planner 的计划）
2. 之前步骤的执行结果

你的职责：
1. 提取步骤中需要传递的参数
2. 调用步骤中指定的工具（可以配合查询工具组合使用）
3. 根据之前的执行结果调整下一步

数据来源：
- 内置销售数据库（地区：华东/华北/华南/西南；产品：笔记本电脑/手机/平板电脑）
- 用户上传的 CSV/Excel 数据文件（通过 queryUploadedData 查询）

工具参数生成规则：
- querySalesData: 地区、产品、日期范围可选，groupBy 必填（region/product/month/none）
- queryUploadedData: action 必填（list/query/info）
- calculateStatistics: metric（sales_amount/quantity）和 operation（sum/avg/max/min/count）必填
- generateChartConfig: type、title、labels、values 必填；多系列用二维数组

完成后用文字总结这一步骤的产出。`;

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
  /**
   * @param {string|object} apiUrlOrEnv - 兼容老调用
   * @param {string} [apiKey]
   * @param {string} [model]
   * @param {object} [db]
   */
  constructor(apiUrlOrEnv, apiKey, model, db) {
    if (typeof apiUrlOrEnv === 'string') {
      this.env = { apiUrl: apiUrlOrEnv, apiKey, model };
      this.db = db;
    } else {
      this.env = apiUrlOrEnv;
      this.db = apiKey;
    }

    this.model = createChatModel(this.env);
    this.tools = buildTools(this.db);
    this.maxSteps = 6;
  }

  async *executeStream(userInput) {
    console.log('\n=== 多 Agent 协作开始 ===');
    console.log('用户需求:', userInput);

    // ========== 1. Planner：生成执行计划 ==========
    yield { event: 'agent', data: { type: 'planner', message: '开始规划任务...' } };

    let plan;
    try {
      const planRes = await generateText({
        model: this.model,
        system: PLANNER_PROMPT,
        messages: [{ role: 'user', content: `用户需求：${userInput}` }],
        temperature: 0.2,
      });
      console.log('Planner 输出:', planRes.text);
      plan = parsePlanJSON(planRes.text);
      yield {
        event: 'agent',
        data: { type: 'planner', message: `规划完成，共 ${plan.steps.length} 步` }
      };
    } catch (error) {
      console.error('Planner 错误:', error.message);
      yield { event: 'error', data: { type: 'error', error: `规划失败: ${error.message}` } };
      return;
    }

    // ========== 2. 循环：Executor + Reviewer ==========
    const chartConfigHolder = { value: null };
    const executionHistory = [];

    for (let stepIdx = 0; stepIdx < this.maxSteps; stepIdx++) {
      console.log(`\n--- 第 ${stepIdx + 1} 步 ---`);
      yield { event: 'step', data: { type: 'step_start', step: stepIdx + 1, message: `正在执行第 ${stepIdx + 1} 步...` } };

      // 当前 plan 步骤
      const currentStep = plan.steps[stepIdx];

      // ----- Executor -----
      if (currentStep) {
        yield { event: 'agent', data: { type: 'executor', message: `执行: ${currentStep.tool}` } };
        yield* this.runExecutorStep(userInput, currentStep, executionHistory, stepIdx + 1, chartConfigHolder);
      }

      // ----- Reviewer -----
      yield { event: 'agent', data: { type: 'reviewer', message: '审查结果...' } };

      let review;
      try {
        const reviewRes = await generateText({
          model: this.model,
          system: REVIEWER_PROMPT,
          messages: [{
            role: 'user',
            content: JSON.stringify({ userInput, history: executionHistory, chartConfig: chartConfigHolder.value }, null, 2)
          }],
          temperature: 0.2,
        });
        review = parsePlanJSON(reviewRes.text);
        console.log('Reviewer 审查:', review.status, review.reason);
        yield { event: 'agent', data: { type: 'reviewer', message: review.reason } };
      } catch (error) {
        console.error('Reviewer 错误:', error.message);
        continue;
      }

      if (review.status === 'complete') {
        yield {
          event: 'complete',
          data: {
            type: 'final_response',
            content: review.reason || '任务完成',
            chartConfig: chartConfigHolder.value,
          }
        };
        return;
      }
      if (review.status === 'failed') {
        yield { event: 'error', data: { type: 'error', error: review.reason } };
        return;
      }

      // 没步骤可执行但 Reviewer 还想继续 -> 终止避免死循环
      if (!currentStep) break;
    }

    yield {
      event: 'complete',
      data: {
        type: 'max_steps_reached',
        content: '已达到最大执行步数',
        chartConfig: chartConfigHolder.value,
      }
    };
  }

  /**
   * Executor 内部：跑一个 plan 步骤
   * - yield 事件（tool_call/tool_result）给外层 executeStream
   * - 直接 push 到 history，修改 chartConfigHolder.value
   */
  async *runExecutorStep(userInput, currentStep, executionHistory, stepNum, chartConfigHolder) {
    const messages = [
      { role: 'system', content: EXECUTOR_PROMPT },
      {
        role: 'user',
        content: `用户需求：${userInput}\n\n当前要执行的步骤：${JSON.stringify(currentStep)}\n\n历史执行结果：${JSON.stringify(executionHistory)}`
      },
    ];

    const result = streamText({
      model: this.model,
      messages,
      tools: this.tools,
      stopWhen: stepCountIs(3),
      temperature: 0.2,
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'start-step':
        case 'step-start':
          // 内部 step 不外流（外层已经在 yield step 1, step 2...）
          break;
        case 'text-delta':
          // Executor 内部思考不外流（避免污染前端）
          break;
        case 'tool-call': {
          // ai@4: part.args  ai@5: part.input
          let args = part.input ?? (typeof part.args === 'string' ? safeJSON(part.args) : part.args);
          if (args === undefined || args === null) args = {};
          executionHistory.push({ step: stepNum, tool: part.toolName, args });
          yield {
            event: 'tool_call',
            data: { type: 'tool_call', tool: part.toolName, args, step: stepNum }
          };
          break;
        }
        case 'tool-result': {
          const r = part.result ?? part.output;
          if (r && r.config) chartConfigHolder.value = r.config;
          const last = executionHistory[executionHistory.length - 1];
          if (last) last.result = { success: r?.success, count: r?.count, summary: summarizeResult(r) };
          yield {
            event: 'tool_result',
            data: {
              type: 'tool_result',
              tool: part.toolName,
              result: { success: r?.success, count: r?.count, summary: summarizeResult(r) },
              step: stepNum,
            }
          };
          break;
        }
        case 'error': {
          console.error('Executor 错误:', part.error);
          break;
        }
        default:
          break;
      }
    }
  }

  summarizeResult(result) {
    return summarizeResult(result);
  }
}

function safeJSON(s) {
  try { return JSON.parse(s); } catch { return s; }
}

function parsePlanJSON(text) {
  if (!text) throw new Error('空响应');
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned);
}

function summarizeResult(result) {
  if (!result) return '无结果';
  if (!result.success) return '执行失败';
  if (result.config) return `生成 ${result.config.type} 图: ${result.config.title}`;
  if (result.data && result.data.length > 0) return `获取到 ${result.count} 条数据`;
  if (result.value !== undefined) return `计算结果: ${result.value}`;
  return '执行成功';
}

export { MultiAgent, PLANNER_PROMPT, EXECUTOR_PROMPT, REVIEWER_PROMPT, parsePlanJSON };
