// 三模式回归测试：DataAgent / MultiAgent / SqlAgent
// 用法：node test-all-agents.mjs

import 'dotenv/config';
import { initDB } from './src/db/index.js';
import { DataAgent, MultiAgent, SqlAgent } from './src/agent/index.js';
import { MultiAgentLangGraph } from './src/agent/multi-agent-langgraph.js';

const env = {
  apiUrl: process.env.API_URL,
  apiKey: process.env.API_KEY,
  model: process.env.LLM_MODEL,
};

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; console.log('  ✅', msg); }
  else { fail++; console.log('  ❌', msg); }
};

async function runAgent(name, agent, userInput, opts = {}) {
  console.log(`\n=== ${name} ===`);
  console.log(`userInput: ${userInput}`);
  const events = {};
  let chartConfig = null;
  let completeCount = 0;
  let hasMessage = false;
  let toolCallCount = 0;
  try {
    for await (const ev of agent.executeStream(userInput)) {
      events[ev.event] = (events[ev.event] || 0) + 1;
      if (ev.event === 'message') hasMessage = true;
      if (ev.event === 'tool_call') toolCallCount++;
      if (ev.event === 'complete') {
        completeCount++;
        chartConfig = ev.data.chartConfig;
      }
    }
    assert(completeCount === 1, `[${name}] 有且仅有 1 个 complete 事件 (实际: ${completeCount})`);
    if (opts.requireMessage) {
      assert(hasMessage, `[${name}] 有流式文本输出`);
    }
    assert(toolCallCount > 0, `[${name}] 至少调用 1 次工具 (实际: ${toolCallCount})`);
    if (opts.requireChart) {
      assert(chartConfig, `[${name}] 最终有 chartConfig`);
      if (chartConfig) {
        assert(chartConfig.type, `[${name}] chartConfig.type 存在: ${chartConfig.type}`);
        assert(chartConfig.labels?.length > 0, `[${name}] chartConfig.labels 长度 > 0 (${chartConfig.labels?.length})`);
        assert(chartConfig.values?.length > 0, `[${name}] chartConfig.values 长度 > 0 (${chartConfig.values?.length})`);
      }
    }
    console.log(`  事件类型: ${Object.entries(events).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    if (chartConfig) {
      console.log(`  图表: ${chartConfig.type} | ${chartConfig.title} | labels=${chartConfig.labels.length} values=${chartConfig.values.length}`);
    }
  } catch (e) {
    fail++;
    console.log('  ❌ 异常:', e.message);
  }
}

async function main() {
  const db = await initDB();
  console.log('DB loaded, records =', db.records?.length ?? db.getAll?.()?.length ?? '?');

  // DataAgent: 默认单 Agent 模式，工具完备
  await runAgent(
    'DataAgent',
    new DataAgent(env, db),
    '用柱状图展示各产品销量',
    { requireChart: true }
  );

  // MultiAgent: Planner/Executor/Reviewer 三段式
  await runAgent(
    'MultiAgent',
    new MultiAgent(env, db),
    '用柱状图展示各产品销量',
    { requireChart: true }
  );

  // SqlAgent: 直发 SQL 模式（避开了 json-engine 对 SUM(field) AS alias 的 toUpperCase bug）
  // 已知限制：SUM/AVG/MAX/MIN 等聚合 + AS 复合语法会被 parser 拒绝（与本次 AI SDK 改造无关）
  await runAgent(
    'SqlAgent',
    new SqlAgent(env, db, { gatewayEnabled: false }),
    '查询 sales_data 表前 5 条数据，简单介绍一下',
    { requireChart: false, requireMessage: true }
  );

  // MultiAgentLangGraph: LangGraph 1.x 状态机驱动版（Planner/Executor/Reviewer）
  // 验证 StateGraph 编排 + 条件边 + checkpoint 行为
  await runAgent(
    'MultiAgentLangGraph',
    new MultiAgentLangGraph(env, db),
    '用柱状图展示各产品销量',
    { requireChart: true, requireMessage: false }
  );

  // Interrupt 流程：验证 thread/paused/interrupt 事件协议
  await runInterruptScenario();

  console.log(`\n=== TOTAL: pass=${pass} fail=${fail} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });

/**
 * Interrupt 流程测试：验证 thread/paused/interrupt 事件协议
 * 用普通查询（Planner 不会标 dangerous），确保新事件不破坏正常流
 */
async function runInterruptScenario() {
  console.log('\n=== Interrupt 流程: 普通查询不应触发 paused/interrupt ===');
  const db = await initDB();
  const agent = new MultiAgentLangGraph(env, db);

  const userInput = '用柱状图展示各产品销量';
  const events = [];
  let threadId = null;
  let hasPaused = false;
  let hasInterrupt = false;

  try {
    for await (const ev of agent.executeStream(userInput)) {
      events.push(ev.event);
      if (ev.event === 'thread') threadId = ev.data.threadId;
      if (ev.event === 'paused') hasPaused = true;
      if (ev.event === 'interrupt_request') hasInterrupt = true;
    }
    assert(threadId, `[Interrupt] 收到 threadId 事件: ${threadId}`);
    assert(events.includes('complete'), `[Interrupt] 普通流程仍然 complete (事件序列: ${events.length})`);
    assert(!hasPaused, `[Interrupt] 普通查询不会触发 paused`);
    assert(!hasInterrupt, `[Interrupt] 普通查询不会触发 interrupt_request`);
  } catch (e) {
    fail++;
    console.log('  ❌ 异常:', e.message);
  }
}
