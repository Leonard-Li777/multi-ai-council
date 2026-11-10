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

  it('should accurately locate assistant message in modern ChatGPT article structure without role attributes', () => {
    document.body.innerHTML = '';

    // 用户提问 article（包含编辑按钮）
    const userArticle = document.createElement('article');
    const userEditBtn = document.createElement('button');
    userEditBtn.setAttribute('aria-label', 'Edit message');
    userArticle.appendChild(userEditBtn);
    const userText = document.createElement('div');
    userText.textContent = '请审查以下规格书方案';
    userArticle.appendChild(userText);
    document.body.appendChild(userArticle);

    // 助手回复 article（现代 ChatGPT 架构：无 data-message-author-role，包含复制按钮）
    const assistantArticle = document.createElement('article');
    const assistantMarkdown = document.createElement('div');
    assistantMarkdown.className = 'markdown prose w-full break-words';
    assistantMarkdown.innerHTML = '<h2>外部红队审查报告</h2><p>经全面穷尽推演，发现以下阻断缺陷：</p>';
    assistantArticle.appendChild(assistantMarkdown);

    const copyBtn = document.createElement('button');
    copyBtn.setAttribute('aria-label', 'Copy response');
    assistantArticle.appendChild(copyBtn);
    document.body.appendChild(assistantArticle);

    // 调用内部查找
    const found = (chatGPTAdapter as any).findLatestAssistantMessageElement();
    expect(found).not.toBeNull();
    expect(found?.textContent).toContain('外部红队审查报告');

    document.body.innerHTML = '';
  });
});
