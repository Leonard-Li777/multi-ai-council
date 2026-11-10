// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { claudeAdapter } from '../lib/adapters/claude.adapter';
import { adapterRegistry } from '../lib/adapters/base';
import { extractConversationId, getTargetDispatchUrl } from '../lib/utils/conversation-helper';

describe('Claude Adapter & Contract Conformance', () => {
  it('should conform to AISiteAdapter metadata contracts', () => {
    expect(claudeAdapter.siteName).toBe('Claude');
    expect(claudeAdapter.adapterVersion).toBe('1.0.0');
    expect(claudeAdapter.urlPattern.test('https://claude.ai/')).toBe(true);
    expect(claudeAdapter.urlPattern.test('https://claude.ai/new')).toBe(true);
    expect(claudeAdapter.urlPattern.test('https://claude.ai/chat/5e8d98c2-3e2b-4fa8-a833-c7e6c986791d')).toBe(true);
    expect(claudeAdapter.urlPattern.test('https://chatgpt.com/')).toBe(false);
  });

  it('should be registered in adapterRegistry', () => {
    expect(adapterRegistry.has('Claude')).toBe(true);
    expect(adapterRegistry.get('Claude')).toBe(claudeAdapter);
  });

  it('should correctly parse Claude conversation URLs and dispatch routes', () => {
    const claudeConvUrl = 'https://claude.ai/chat/5e8d98c2-3e2b-4fa8-a833-c7e6c986791d';
    expect(extractConversationId(claudeConvUrl)).toBe('5e8d98c2-3e2b-4fa8-a833-c7e6c986791d');

    const continuationUrl = getTargetDispatchUrl('Claude', true, {
      siteName: 'Claude',
      conversationId: '5e8d98c2-3e2b-4fa8-a833-c7e6c986791d',
      conversationUrl: claudeConvUrl,
      lastUpdatedAt: Date.now(),
    });
    expect(continuationUrl).toBe(claudeConvUrl);

    const newChatUrl = getTargetDispatchUrl('Claude', false);
    expect(newChatUrl).toBe('https://claude.ai/new');
  });

  it('should clean floating running progress status from Claude messages during generation', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';

    const assistantMsg = document.createElement('div');
    assistantMsg.setAttribute('data-is-streaming', 'true');
    assistantMsg.className = 'font-claude-message';
    document.body.appendChild(assistantMsg);

    let capturedText = '';
    const stopListening = claudeAdapter.listenGeneration(
      (snapshot) => {
        capturedText = snapshot;
      },
      () => {}
    );

    // 包含正文
    const contentP = document.createElement('p');
    contentP.textContent = '这是 Claude 输出的正式审查报告内容。';
    assistantMsg.appendChild(contentP);

    // 包含运行中进度指示器
    const progressDiv = document.createElement('div');
    progressDiv.className = 'progressive-status';
    progressDiv.textContent = '2分钟 1秒运行中';
    assistantMsg.appendChild(progressDiv);

    // 推进时钟让轮询感知长度变化并触发 onUpdate
    vi.advanceTimersByTime(600);

    expect(capturedText).toContain('这是 Claude 输出的正式审查报告内容');
    expect(capturedText).not.toContain('2分钟 1秒运行中');

    stopListening();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });
});
