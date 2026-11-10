// @vitest-environment happy-dom
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

  it('qwenAdapter extracts full message with multiple markdown blocks and disclaimers', () => {
    document.body.innerHTML = `
      <div class="message-item-assistant">
        <div class="qwen-markdown">
          <p># 规格说明书审查评估报告</p>
          <p>详细分析第一条：架构完全吻合契约。</p>
        </div>
        <div class="qwen-markdown">
          <p>**声明**：本轮审查已全盘穷尽当前规范。</p>
        </div>
      </div>
    `;

    qwenAdapter.recordBaseline();
    // Simulate generation of new message
    document.body.innerHTML += `
      <div class="message-item-assistant">
        <div class="qwen-markdown">
          <p># 第二轮规格说明书审查评估报告</p>
          <p>详细分析：全量业务逻辑验证完全符合预期，跨越五千字大报告主体内容。</p>
        </div>
        <div class="qwen-markdown">
          <p>**声明**：本轮审查已全盘穷尽当前《E2E Testing & Golden Ground Truth Spec v2.0》。</p>
        </div>
      </div>
    `;

    let capturedDone = '';
    const stopListener = qwenAdapter.listenGeneration(
      () => {},
      (cleaned) => {
        capturedDone = cleaned;
      }
    );

    // Call getCurrentContent through the active detector
    const detector = (qwenAdapter as any).activeDetector;
    const current = detector.options.getCurrentContent();
    expect(current).toContain('第二轮规格说明书审查评估报告');
    expect(current).toContain('本轮审查已全盘穷尽当前《E2E Testing & Golden Ground Truth Spec v2.0》');

    stopListener();
  });

  it('wenxinAdapter extracts all markdown/text segments without truncating to first child', () => {
    document.body.innerHTML = `
      <div class="chat-message assistant">
        <div class="eb-markdown">
          <h3>[ISS-01] voerkai18n 静态扫描存在漏词盲区</h3>
          <p>关联方案锚点：PLAN-SEC-03</p>
        </div>
        <div class="eb-markdown">
          <h3>[ISS-02] 缺少增量热更新回滚幂等性防护</h3>
          <p>关联方案锚点：PLAN-SEC-08</p>
        </div>
      </div>
    `;

    wenxinAdapter.recordBaseline();

    document.body.innerHTML += `
      <div class="chat-message assistant">
        <div class="eb-markdown">
          <h3>[ISS-01] 第二轮问题一</h3>
          <p>关联方案锚点：PLAN-SEC-03 详细审查内容</p>
        </div>
        <div class="eb-markdown">
          <h3>[ISS-02] 第二轮问题二</h3>
          <p>关联方案锚点：PLAN-SEC-08 关键缺失防护</p>
        </div>
      </div>
    `;

    const stopListener = wenxinAdapter.listenGeneration(
      () => {},
      () => {}
    );

    const detector = (wenxinAdapter as any).activeDetector;
    const current = detector.options.getCurrentContent();
    expect(current).toContain('第二轮问题一');
    expect(current).toContain('第二轮问题二');
    expect(current).toContain('关键缺失防护');

    stopListener();
  });

  it('chatGPTAdapter prefers #prompt-textarea over #pending-home-input', () => {
    document.body.innerHTML = `
      <textarea id="pending-home-input"></textarea>
      <div id="prompt-textarea" contenteditable="true"><p></p></div>
    `;

    const input = (chatGPTAdapter as any).findInputElement();
    expect(input?.id).toBe('prompt-textarea');
  });
});
