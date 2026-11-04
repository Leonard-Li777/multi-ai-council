import type { SupportedSite, ProviderConversationRef } from '../types/review-job';

export const SITE_BASE_URLS: Record<SupportedSite, string> = {
  DeepSeek: 'https://chat.deepseek.com/',
  ChatGPT: 'https://chatgpt.com/',
  Claude: 'https://claude.ai/',
  Gemini: 'https://gemini.google.com/',
  Qwen: 'https://chat.qwen.ai/',
  Wenxin: 'https://wenxin.baidu.com/',
  ChatGLM: 'https://chatglm.cn/',
};

/**
 * 从页面 URL 中提取远端会话唯一标识符
 */
export function extractConversationId(url: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    // DeepSeek 会话路径形如 /a/chat/s/:id
    const deepseekMatch = parsed.pathname.match(/\/a\/chat\/s\/([a-zA-Z0-9_-]+)/);
    if (deepseekMatch) {
      return deepseekMatch[1] ?? null;
    }

    // 通用路径匹配：提取会话 ID 候选
    const parts = parsed.pathname.split('/').filter(Boolean);
    // ChatGPT / Qwen: /c/:id
    if (parts.length >= 2 && parts[0] === 'c') {
      return parts[1] ?? null;
    }
    // Claude: /chat/:id
    if (parts.length >= 2 && parts[0] === 'chat') {
      return parts[1] ?? null;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 依据会话延续性与历史会话引用解析目标分发 URL
 */
export function getTargetDispatchUrl(
  siteName: SupportedSite,
  isContinuation: boolean,
  ref?: ProviderConversationRef
): string {
  const baseUrl = SITE_BASE_URLS[siteName] || 'https://chat.deepseek.com/';

  if (isContinuation && ref && ref.conversationUrl) {
    return ref.conversationUrl;
  }

  return baseUrl;
}
