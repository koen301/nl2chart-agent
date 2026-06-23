/**
 * Multi Agent —— LangGraph 重构版
 *
 * 设计理念：
 * - Planner / Executor / Reviewer 三段式不变（保持业务行为）
 * - 编排层换成 LangGraph StateGraph（声明式状态机 + 条件边）
 * - 节点内部 LLM 调用继续用 Vercel AI SDK（streamText / generateText）
 * - 通过 getWriter() 把节点内部事件 emit 到 graph stream（streamMode: 'custom'）
 * - 沿用现有 SSE 事件协议（step / agent / message / tool_call / tool_result / complete）
 *
 * 与 multi-agent.js 的区别：
 * - 旧版用 for 循环 + 局部变量维护流程
 * - 新版用 StateGraph + 显式 State Schema（可序列化、可 checkpoint、可 time-travel）
 */

import { StateGraph, START, END, Annotation, MemorySaver, getWriter, interrupt, Command } from '@langchain/langgraph';
import { streamText, generateText, stepCountIs } from 'ai';
import { createChatModel } from './llm.js';
import { buildTools } from './tools.js';
import { PLANNER_PROMPT, EXECUTOR_PROMPT, REVIEWER_PROMPT, parsePlanJSON } from './multi-agent.js';

// ========== 1. State Schema ==========
// 用 Annotation 定义 graph state，reducer 决定字段如何合并
const AgentState = Annotation.Root({
  userInput: Annotation(),                                   // 用户原始需求
  plan: Annotation(),                                        // Planner 输出：{ steps, finalAction }
  stepIndex: Annotation(0),                                  // 当前执行到 plan 的第几步（0-based）
  stepNumber: Annotation(0),                                 // 全局 step 计数（1-based，给前端展示用）
  executionHistory: Annotation(() => []),                    // 工具调用累积
  chartConfig: Annotation(),                                 // 累积的图表配置
  reviewStatus: Annotation('continue'),                       // 'continue' | 'complete' | 'failed'
  reviewReason: Annotation(''),                              // Reviewer 的理由
});

// ========== 2. MultiAgentLangGraph Class ==========
export class MultiAgentLangGraph {
  constructor(env, db, opts = {}) {
    this.model = createChatModel(env);
    this.tools = buildTools(db);
    this.maxSteps = opts.maxSteps ?? 5;
    this.graph = this._buildGraph();
  }

  _buildGraph() {
    const builder = new StateGraph(AgentState);

    // 节点：3 个 Agent（带 metadata，LangSmith trace 会显示这些信息）
    builder.addNode('planner', (state) => this._plannerNode(state), {
      metadata: { role: 'planner', description: '任务规划：拆解用户需求为执行步骤' }
    });
    builder.addNode('executor', (state) => this._executorNode(state), {
      metadata: { role: 'executor', description: '步骤执行：调用 Vercel AI SDK + Zod 工具' }
    });
    builder.addNode('reviewer', (state) => this._reviewerNode(state), {
      metadata: { role: 'reviewer', description: '结果审查：判断 continue / complete / failed' }
    });

    // 边：线性主干
    builder.addEdge(START, 'planner');
    builder.addEdge('planner', 'executor');
    builder.addEdge('executor', 'reviewer');

    // 条件边：Reviewer 决定下一步
    builder.addConditionalEdges(
      'reviewer',
      (state) => {
        if (state.reviewStatus === 'complete') return 'complete';
        if (state.reviewStatus === 'failed') return 'failed';
        // continue 但 plan 已执行完 → 结束
        if (state.stepIndex >= (state.plan?.steps?.length || 0)) return 'no_more_steps';
        if (state.stepNumber >= this.maxSteps) return 'no_more_steps';
        return 'continue';
      },
      {
        continue: 'executor',
        complete: END,
        failed: END,
        no_more_steps: END,
      }
    );

    // 编译：配 MemorySaver 启用 checkpoint
    return builder.compile({ checkpointer: new MemorySaver() });
  }

  // ----- Planner Node -----
  async _plannerNode(state) {
    const writer = getWriter();
    writer({ event: 'agent', data: { type: 'planner', message: '正在规划执行步骤...' } });

    let plan;
    try {
      const res = await generateText({
        model: this.model,
        system: PLANNER_PROMPT,
        messages: [{ role: 'user', content: `用户需求：${state.userInput}` }],
        temperature: 0.2,
      });
      plan = parsePlanJSON(res.text);
      writer({ event: 'agent', data: { type: 'planner', message: `规划完成，共 ${plan.steps.length} 步` } });
    } catch (err) {
      writer({ event: 'error', data: { type: 'error', error: `规划失败: ${err.message}` } });
      throw err;
    }

    return { plan, stepIndex: 0, stepNumber: 0, executionHistory: [], chartConfig: null };
  }

  // ----- Executor Node -----
  async _executorNode(state) {
    const writer = getWriter();
    const stepNumber = state.stepNumber + 1;
    const currentStep = state.plan.steps[state.stepIndex];

    writer({
      event: 'step',
      data: { type: 'step_start', step: stepNumber, message: `正在执行第 ${stepNumber} 步...` }
    });

    if (!currentStep) {
      // 防御：plan 已无步骤可执行
      return { stepIndex: state.stepIndex + 1, stepNumber };
    }

    // ========== 人机 interrupt：高危操作拦截 ==========
    // Planner 在 step 里标 dangerous: true 时，暂停让用户确认
    if (currentStep.dangerous === true) {
      writer({
        event: 'interrupt_request',
        data: {
          step: stepNumber,
          action: currentStep.tool,
          args: currentStep.args || currentStep.parameters || null,
          reason: currentStep.reason,
          question: `即将执行高危操作：${currentStep.tool}，是否继续？`,
        }
      });

      // interrupt() 抛 GraphInterrupt 异常暂停 graph，payload 写入 checkpoint
      // 客户端通过 /api/agent/resume 提交决策，graph 会从这里恢复
      const decision = interrupt({
        type: 'approval',
        step: stepNumber,
        action: currentStep.tool,
        reason: currentStep.reason,
        question: `即将执行高危操作：${currentStep.tool}，是否继续？`,
      });

      // decision = { decision: 'approve' } | { decision: 'reject' }
      writer({
        event: 'interrupt_resolve',
        data: { step: stepNumber, decision: decision?.decision }
      });

      if (!decision || decision.decision === 'reject') {
        return {
          reviewStatus: 'failed',
          reviewReason: '用户拒绝执行该高危操作',
        };
      }
      // approve：继续正常执行（step.args 已经被审批通过，保持不变）
    }

    writer({ event: 'agent', data: { type: 'executor', message: `执行: ${currentStep.tool}` } });

    let chartConfig = state.chartConfig;
    const newHistory = [...state.executionHistory];

    const result = streamText({
      model: this.model,
      system: EXECUTOR_PROMPT,
      messages: [{
        role: 'user',
        content: JSON.stringify({
          userInput: state.userInput,
          currentStep,
          history: state.executionHistory,
        }, null, 2)
      }],
      tools: this.tools,
      stopWhen: stepCountIs(3),
      temperature: 0.2,
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta': {
          const content = part.textDelta ?? part.text ?? '';
          writer({
            event: 'message',
            data: { type: 'content', content, step: stepNumber, isEnd: false }
          });
          break;
        }
        case 'tool-call': {
          // v4: part.args (string|object)  v5: part.input (object)
          const args = part.input ?? (typeof part.args === 'string'
            ? safeJSON(part.args)
            : part.args);
          newHistory.push({ step: stepNumber, tool: part.toolName, args });
          writer({
            event: 'tool_call',
            data: { type: 'tool_call', tool: part.toolName, args, step: stepNumber }
          });
          break;
        }
        case 'tool-result': {
          const r = part.result ?? part.output;
          if (r && r.config) chartConfig = r.config;
          writer({
            event: 'tool_result',
            data: { type: 'tool_result', tool: part.toolName, result: r, step: stepNumber }
          });
          break;
        }
      }
    }

    return {
      chartConfig,
      executionHistory: newHistory,
      stepIndex: state.stepIndex + 1,
      stepNumber,
    };
  }

  // ----- Reviewer Node -----
  async _reviewerNode(state) {
    const writer = getWriter();
    writer({ event: 'agent', data: { type: 'reviewer', message: '审查结果...' } });

    let review;
    try {
      const res = await generateText({
        model: this.model,
        system: REVIEWER_PROMPT,
        messages: [{
          role: 'user',
          content: JSON.stringify({
            userInput: state.userInput,
            history: state.executionHistory,
            chartConfig: state.chartConfig,
          }, null, 2)
        }],
        temperature: 0.2,
      });
      review = parsePlanJSON(res.text);
      writer({ event: 'agent', data: { type: 'reviewer', message: review.reason } });
    } catch (err) {
      // 审查失败默认继续下一轮
      review = { status: 'continue', reason: `审查异常: ${err.message}` };
    }

    return {
      reviewStatus: review.status || 'continue',
      reviewReason: review.reason || '',
    };
  }

  // ========== 3. SSE 适配器 ==========
  /**
   * 把 LangGraph stream 包装成现有 SSE 事件协议
   * 事件类型：agent / step / message / tool_call / tool_result / interrupt_request / interrupt_resolve / paused / complete / error
   */
  async *executeStream(userInput) {
    yield { event: 'agent', data: { type: 'start', message: '=== 多 Agent 流程启动（LangGraph 驱动）===' } };

    const threadId = `multi-agent-${Date.now()}`;
    const config = {
      configurable: { thread_id: threadId },
      tags: ['multi-agent', 'ai-sdk', 'v1'],
      metadata: {
        userInput: userInput.substring(0, 100),
        threadId,
        version: 'langgraph-1.4',
      },
    };
    const input = { userInput };

    // 把 threadId 早一点给前端，前端后面 resume 用
    yield { event: 'thread', data: { threadId } };

    try {
      // streamMode: 'custom' 让 getWriter() emit 的事件能流出来
      const stream = await this.graph.stream(input, { ...config, streamMode: 'custom' });
      try {
        for await (const ev of stream) {
          if (ev && ev.event) yield ev;
        }
      } catch (innerErr) {
        // interrupt() 抛 GraphInterrupt → stream 结束
        // 不是真错误，继续走"检查是否 paused"分支
        if (!this._isInterruptException(innerErr)) throw innerErr;
      }

      // 检查 graph 是否处于 interrupt 暂停状态
      const state = await this.graph.getState(config);
      if (this._isInterrupted(state)) {
        const interrupts = this._extractInterrupts(state);
        yield {
          event: 'paused',
          data: {
            threadId,
            reason: 'awaiting_user_approval',
            interrupts,  // [{ id, payload }]
          }
        };
        // 暂停时不再 yield complete，让前端知道要等用户决策
        return;
      }

      // 正常完成：读最终状态
      const values = state?.values || {};
      yield {
        event: 'complete',
        data: {
          type: 'final_response',
          content: values.reviewReason || '任务完成',
          chartConfig: values.chartConfig,
        }
      };
    } catch (err) {
      console.error('[MultiAgentLangGraph] 流程错误:', err);
      yield { event: 'error', data: { type: 'error', error: err.message } };
    }
  }

  /**
   * 恢复 graph：用用户的决策继续被打断的节点
   * 客户端传 threadId + decision（{ decision: 'approve' | 'reject' }）
   */
  async *resumeStream(threadId, decision) {
    const config = {
      configurable: { thread_id: threadId },
      tags: ['multi-agent', 'ai-sdk', 'v1', 'resume'],
      metadata: { threadId, version: 'langgraph-1.4' },
    };

    yield {
      event: 'agent',
      data: { type: 'resume', message: `用户决策: ${decision?.decision || 'unknown'}，继续执行...` }
    };

    try {
      // 用 Command({ resume }) 传回决策
      const stream = await this.graph.stream(
        new Command({ resume: decision }),
        { ...config, streamMode: 'custom' }
      );
      try {
        for await (const ev of stream) {
          if (ev && ev.event) yield ev;
        }
      } catch (innerErr) {
        // resume 后又触发新 interrupt（如多个 dangerous step）
        if (!this._isInterruptException(innerErr)) throw innerErr;
      }

      const state = await this.graph.getState(config);
      if (this._isInterrupted(state)) {
        yield {
          event: 'paused',
          data: {
            threadId,
            reason: 'awaiting_user_approval',
            interrupts: this._extractInterrupts(state),
          }
        };
        return;
      }

      const values = state?.values || {};
      yield {
        event: 'complete',
        data: {
          type: 'final_response',
          content: values.reviewReason || '任务完成',
          chartConfig: values.chartConfig,
        }
      };
    } catch (err) {
      console.error('[MultiAgentLangGraph] resume 错误:', err);
      yield { event: 'error', data: { type: 'error', error: err.message } };
    }
  }

  // ----- 内部 helper -----
  _isInterruptException(err) {
    // LangGraph 抛 GraphInterrupt 异常，名字在不同版本可能是 GraphInterrupt / NodeInterrupt
    if (!err) return false;
    const name = err.name || err.constructor?.name || '';
    return name.includes('Interrupt') || err.__interrupt !== undefined;
  }

  _isInterrupted(state) {
    if (!state) return false;
    // 优先看顶层 __interrupt__
    if (Array.isArray(state.__interrupt__) && state.__interrupt__.length > 0) return true;
    // 否则看 tasks
    if (Array.isArray(state.tasks)) {
      for (const t of state.tasks) {
        if (Array.isArray(t.interrupts) && t.interrupts.length > 0) return true;
      }
    }
    return false;
  }

  _extractInterrupts(state) {
    if (Array.isArray(state?.__interrupt__) && state.__interrupt__.length > 0) {
      return state.__interrupt__.map(i => ({ id: i.id, payload: i.value }));
    }
    const list = [];
    for (const t of state?.tasks || []) {
      for (const i of t.interrupts || []) {
        list.push({ id: i.id, payload: i.value });
      }
    }
    return list;
  }
}

// ========== 4. 工具函数 ==========
function safeJSON(s) {
  try { return JSON.parse(s); } catch { return s; }
}
