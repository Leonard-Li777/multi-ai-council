import { describe, it, expect } from 'vitest';
import { adapterRegistry } from '../lib/adapters/base';
import { deepSeekAdapter } from '../lib/adapters/deepseek.adapter';
import { chatGPTAdapter } from '../lib/adapters/chatgpt.adapter';
import { claudeAdapter } from '../lib/adapters/claude.adapter';
import { qwenAdapter } from '../lib/adapters/qwen.adapter';
import { wenxinAdapter } from '../lib/adapters/wenxin.adapter';
import { chatGLMAdapter } from '../lib/adapters/chatglm.adapter';
import { geminiAdapter } from '../lib/adapters/gemini.adapter';
import { stripThinkBlocks } from '../lib/utils/think-block-strip';
import type { SupportedSite } from '../lib/types/review-job';

describe('All 7 Supported Site Adapters & Registry Conformance', () => {
  const allSites: SupportedSite[] = [
    'DeepSeek',
    'ChatGPT',
    'Claude',
    'Gemini',
    'Qwen',
    'Wenxin',
    'ChatGLM',
  ];

  it('should have all 7 adapters registered in adapterRegistry', () => {
    for (const site of allSites) {
      expect(adapterRegistry.has(site)).toBe(true);
      const adapter = adapterRegistry.get(site);
      expect(adapter).toBeDefined();
      expect(adapter?.siteName).toBe(site);
      expect(adapter?.adapterVersion).toBe('1.0.0');
    }
  });

  it('should accurately test URL patterns for all 7 sites', () => {
    expect(qwenAdapter.urlPattern.test('https://chat.qwen.ai/')).toBe(true);
    expect(qwenAdapter.urlPattern.test('https://chat.qwen.ai/c/123')).toBe(true);

    expect(wenxinAdapter.urlPattern.test('https://wenxin.baidu.com/')).toBe(true);

    expect(chatGLMAdapter.urlPattern.test('https://chatglm.cn/')).toBe(true);
    expect(chatGLMAdapter.urlPattern.test('https://chatglm.cn/main/gchat/abc')).toBe(true);

    expect(geminiAdapter.urlPattern.test('https://gemini.google.com/')).toBe(true);
    expect(geminiAdapter.urlPattern.test('https://gemini.google.com/app/123')).toBe(true);
  });

  it('should cleanly strip reasoning <think> blocks and Chinese think markers', () => {
    const qwenRawOutput = `<think>
正在分析用户的技术方案...
分析完毕。
</think>
方案的核心是基于 MV3 架构，具备优秀的弹性。`;

    const { cleaned, thinkContent } = stripThinkBlocks(qwenRawOutput);
    expect(thinkContent).toContain('正在分析用户的技术方案');
    expect(cleaned).toBe('方案的核心是基于 MV3 架构，具备优秀的弹性。');
    expect(cleaned).not.toContain('<think>');

    const chineseMarkerRaw = `【思考过程】
权衡利弊后决定采用选项 B。
【思考结束】
我们推荐采用选项 B。`;

    const result2 = stripThinkBlocks(chineseMarkerRaw);
    expect(result2.cleaned).toBe('我们推荐采用选项 B。');
  });
});
