/**
 * LangSmith 集成助手
 *
 * LangGraph 1.x + LangSmith 0.7.x 集成：
 * - LangGraph 自动 trace（只要设 env，零代码）
 * - 本文件只做：环境检测 + 启动 banner + 降级方案
 *
 * 启用方式（.env）：
 *   LANGSMITH_TRACING=true
 *   LANGSMITH_API_KEY=lsv2_pt_...        # https://smith.langchain.com 注册免费拿
 *   LANGSMITH_PROJECT=nl2chart-agent
 *
 * 不启用：LangGraph 仍然正常工作，只是没有 trace 上报
 *
 * 依赖说明：
 * - `langsmith` 是 langgraph 的 optional peer dep，本文件用 dynamic import
 * - 避免在 package.json 硬性声明，未装/未启用时不会影响主流程
 */

const LANGSMITH_TRACING = process.env.LANGSMITH_TRACING || process.env.LANGCHAIN_TRACING_V2;
const LANGSMITH_API_KEY = process.env.LANGSMITH_API_KEY || process.env.LANGCHAIN_API_KEY;
const LANGSMITH_PROJECT = process.env.LANGSMITH_PROJECT || process.env.LANGCHAIN_PROJECT || 'default';
const LANGSMITH_ENDPOINT = process.env.LANGSMITH_ENDPOINT || 'https://api.smith.langchain.com';

let _client = null;

export function isLangSmithEnabled() {
  return Boolean(LANGSMITH_TRACING && LANGSMITH_API_KEY);
}

export function getLangSmithConfig() {
  if (!isLangSmithEnabled()) return null;
  return {
    apiKey: LANGSMITH_API_KEY,
    project: LANGSMITH_PROJECT,
    endpoint: LANGSMITH_ENDPOINT,
  };
}

/**
 * 启动 banner：在 server 启动时打印 LangSmith 状态
 */
export function printBanner() {
  const enabled = isLangSmithEnabled();
  const line = '─'.repeat(58);

  console.log(`\n┌${line}┐`);
  console.log('│  📊 LangSmith 集成状态' + ' '.repeat(34) + '│');
  console.log(`├${line}┤`);
  console.log(`│  启用状态: ${enabled ? '✅ ON ' : '❌ OFF'}  ${enabled ? '(trace 上报到 LangSmith 云端)' : '(本地模式，无 trace 上报)'.padEnd(35)}│`);
  console.log(`│  Project : ${LANGSMITH_PROJECT.padEnd(48)}│`);
  console.log(`│  Endpoint: ${LANGSMITH_ENDPOINT.padEnd(48)}│`);
  console.log(`├${line}┤`);
  if (enabled) {
    console.log('│  🔗 Dashboard: https://smith.langchain.com/' + ' '.repeat(15) + '│');
    console.log('│  💡 启动后所有 Agent 调用会出现在 project 视图下' + ' '.repeat(11) + '│');
  } else {
    console.log('│  💡 注册免费账号: https://smith.langchain.com/' + ' '.repeat(13) + '│');
    console.log('│     然后在 .env 配 LANGSMITH_TRACING=true + API_KEY' + ' '.repeat(8) + '│');
  }
  console.log(`└${line}┘\n`);
}

/**
 * 健康检查：启动时 ping 一下 LangSmith 验证 key 有效
 * 失败不抛错，只警告，避免影响主流程
 */
export async function healthCheck() {
  if (!isLangSmithEnabled()) return { ok: false, reason: '未启用' };
  try {
    if (!_client) {
      // Dynamic import：避免未装 langsmith 时崩溃
      const { Client } = await import('langsmith');
      _client = new Client({
        apiKey: LANGSMITH_API_KEY,
        apiUrl: LANGSMITH_ENDPOINT,
      });
    }
    const projects = await _client.listProjects({ limit: 1 });
    return { ok: true, project: LANGSMITH_PROJECT, sample: projects?.[0]?.name };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}
