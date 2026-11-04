import { describe, it, expect } from 'vitest';
import { extractConversationId, getTargetDispatchUrl, SITE_BASE_URLS } from '../lib/utils/conversation-helper';
import type { ProviderConversationRef, SupportedSite } from '../lib/types/review-job';

describe('Conversation Reference & Multi-Turn Helpers', () => {
  it('should correctly extract conversationId from DeepSeek URLs', () => {
    const url1 = 'https://chat.deepseek.com/a/chat/s/84a20f9a-1178-4394-bb97-f58c7e96b3a0';
    expect(extractConversationId(url1)).toBe('84a20f9a-1178-4394-bb97-f58c7e96b3a0');

    const url2 = 'https://chat.deepseek.com/';
    expect(extractConversationId(url2)).toBeNull();

    const url3 = 'https://chat.deepseek.com/a/chat/s/abc12345?share=true';
    expect(extractConversationId(url3)).toBe('abc12345');

    const url4 = 'https://chatgpt.com/c/672a9b31-112c-8005-b129-918237192831';
    expect(extractConversationId(url4)).toBe('672a9b31-112c-8005-b129-918237192831');
  });

  it('should handle invalid or malformed URLs gracefully without crashing', () => {
    expect(extractConversationId('')).toBeNull();
    expect(extractConversationId('not-a-valid-url')).toBeNull();
    expect(extractConversationId('javascript:void(0)')).toBeNull();
  });

  it('should resolve correct target dispatch URL for continuation vs new chat', () => {
    const existingRef: ProviderConversationRef = {
      siteName: 'DeepSeek',
      conversationId: 'session-uuid-123',
      conversationUrl: 'https://chat.deepseek.com/a/chat/s/session-uuid-123',
      lastUpdatedAt: 1700000000000,
    };

    // 1. 延续已有会话 -> 复用历史会话 URL
    const continuationUrl = getTargetDispatchUrl('DeepSeek', true, existingRef);
    expect(continuationUrl).toBe('https://chat.deepseek.com/a/chat/s/session-uuid-123');

    // 2. 开启新会话 -> 返回站点根路径
    const newChatUrl = getTargetDispatchUrl('DeepSeek', false, existingRef);
    expect(newChatUrl).toBe('https://chat.deepseek.com/');

    // 3. 虽要求延续，但无历史会话 -> 兜底返回根路径
    const fallbackUrl = getTargetDispatchUrl('DeepSeek', true, undefined);
    expect(fallbackUrl).toBe('https://chat.deepseek.com/');
  });

  it('should provide valid base URLs for all 7 supported sites', () => {
    const sites: SupportedSite[] = ['DeepSeek', 'ChatGPT', 'Claude', 'Gemini', 'Qwen', 'Wenxin', 'ChatGLM'];
    for (const site of sites) {
      const baseUrl = SITE_BASE_URLS[site];
      expect(baseUrl).toBeDefined();
      expect(baseUrl.startsWith('https://')).toBe(true);
      expect(getTargetDispatchUrl(site, false)).toBe(baseUrl);
    }
  });
});
