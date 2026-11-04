import { describe, it, expect } from 'vitest';
import { revealModelIdentities, sanitizeHtml } from '../lib/utils/markdown-viewer';

describe('Markdown Viewer & DOMPurify Security Tests', () => {
  it('should sanitize unsafe script tags and malicious attributes', () => {
    const maliciousHtml = '<p>正常段落</p><script>alert("xss")</script><img src="x" onerror="alert(1)">';
    const clean = sanitizeHtml(maliciousHtml);
    expect(clean).not.toContain('<script>');
    expect(clean).not.toContain('onerror');
    expect(clean).toContain('<p>正常段落</p>');
  });

  it('should accurately reveal model identities in text without duplicate nesting', () => {
    const text = '经判定，Model A 与 Model B 在架构设计上持有相同观点，而 Model C 建议采用方案 B。';
    const anonymousMap = {
      'Model A': 'DeepSeek' as const,
      'Model B': 'ChatGPT' as const,
      'Model C': 'Claude' as const,
    };

    const revealed = revealModelIdentities(text, anonymousMap);
    expect(revealed).toContain('Model A (DeepSeek)');
    expect(revealed).toContain('Model B (ChatGPT)');
    expect(revealed).toContain('Model C (Claude)');

    // 再次调用不应出现嵌套 Model A (DeepSeek) (DeepSeek)
    const revealedTwice = revealModelIdentities(revealed, anonymousMap);
    expect(revealedTwice).not.toContain('(DeepSeek) (DeepSeek)');
  });
});
