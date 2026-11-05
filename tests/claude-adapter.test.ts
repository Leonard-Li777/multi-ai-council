import { describe, it, expect } from 'vitest';
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
});
