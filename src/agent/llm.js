/**
 * LLM 统一封装
 *
 * 改造前：3 个 Agent 文件各自写 axios.post(API_URL, {...})
 * 改造后：1 个 createChatModel() 工厂，所有 Agent 共用
 *
 * 支持任何 OpenAI 兼容协议的服务商：
 * - SiliconFlow、智谱、月之暗面、OpenAI、Azure OpenAI...
 * - 切换服务商只需改 .env 的 API_URL / API_KEY / LLM_MODEL
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export function createChatModel({ apiUrl, apiKey, model }) {
  return createOpenAICompatible({
    name: 'openai-compatible',
    baseURL: extractBaseURL(apiUrl),
    apiKey,
  })(model);
}

function extractBaseURL(apiUrl) {
  // 兼容传入 /v1/chat/completions、/chat/completions、纯 baseURL
  try {
    const u = new URL(apiUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return apiUrl
      .replace(/\/v\d+\/chat\/completions.*$/, '')
      .replace(/\/chat\/completions.*$/, '');
  }
}
