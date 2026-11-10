// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { chatGPTAdapter } from '../lib/adapters/chatgpt.adapter';
import { deepSeekAdapter } from '../lib/adapters/deepseek.adapter';
import { adapterRegistry } from '../lib/adapters/base';
import { extractConversationId, getTargetDispatchUrl } from '../lib/utils/conversation-helper';

describe('ChatGPT Adapter & Contract Conformance', () => {
  it('should conform to AISiteAdapter metadata contracts', () => {
    expect(chatGPTAdapter.siteName).toBe('ChatGPT');
    expect(chatGPTAdapter.adapterVersion).toBe('1.0.0');
    expect(chatGPTAdapter.urlPattern.test('https://chatgpt.com/')).toBe(true);
    expect(chatGPTAdapter.urlPattern.test('https://chatgpt.com/c/672a9b31-112c-8005-b129-918237192831')).toBe(true);
    expect(chatGPTAdapter.urlPattern.test('https://chatgpt.com/?model=gpt-4o')).toBe(true);
    expect(chatGPTAdapter.urlPattern.test('https://chat.deepseek.com/')).toBe(false);
  });

  it('should be registered in adapterRegistry alongside DeepSeek', () => {
    expect(adapterRegistry.has('ChatGPT')).toBe(true);
    expect(adapterRegistry.get('ChatGPT')).toBe(chatGPTAdapter);
    expect(adapterRegistry.has('DeepSeek')).toBe(true);
    expect(adapterRegistry.get('DeepSeek')).toBe(deepSeekAdapter);
  });

  it('should correctly parse ChatGPT conversation URLs and dispatch routes', () => {
    const chatGptConvUrl = 'https://chatgpt.com/c/abcd-efgh-1234';
    expect(extractConversationId(chatGptConvUrl)).toBe('abcd-efgh-1234');

    const continuationUrl = getTargetDispatchUrl('ChatGPT', true, {
      siteName: 'ChatGPT',
      conversationId: 'abcd-efgh-1234',
      conversationUrl: chatGptConvUrl,
      lastUpdatedAt: Date.now(),
    });
    expect(continuationUrl).toBe(chatGptConvUrl);

    const newChatUrl = getTargetDispatchUrl('ChatGPT', false);
    expect(newChatUrl).toBe('https://chatgpt.com/');
  });

  it('should ignore #pending-home-input and only return ready, interactive input elements', () => {
    document.body.innerHTML = '';

    // 场景 1：页面上仅有 SSR 未水合的 #pending-home-input 占位符
    const pendingTextarea = document.createElement('textarea');
    pendingTextarea.id = 'pending-home-input';
    document.body.appendChild(pendingTextarea);

    expect(chatGPTAdapter.findInputElement()).toBeNull();

    // 场景 2：React 完成水合，挂载真实可交互 #prompt-textarea (ProseMirror 富文本)
    const realInput = document.createElement('div');
    realInput.id = 'prompt-textarea';
    realInput.setAttribute('contenteditable', 'true');
    realInput.className = 'ProseMirror';
    document.body.appendChild(realInput);

    expect(chatGPTAdapter.findInputElement()).toBe(realInput);

    // 清理
    document.body.innerHTML = '';
  });
});
