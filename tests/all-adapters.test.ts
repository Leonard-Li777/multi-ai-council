// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { adapterRegistry } from '../lib/adapters/base';
import { deepSeekAdapter } from '../lib/adapters/deepseek.adapter';
import { chatGPTAdapter } from '../lib/adapters/chatgpt.adapter';
import { claudeAdapter } from '../lib/adapters/claude.adapter';
import { qwenAdapter } from '../lib/adapters/qwen.adapter';
import { wenxinAdapter } from '../lib/adapters/wenxin.adapter';
import { geminiAdapter } from '../lib/adapters/gemini.adapter';
import { stripThinkBlocks } from '../lib/utils/think-block-strip';
import type { SupportedSite } from '../lib/types/review-job';

describe('All 6 Supported Site Adapters & Registry Conformance', () => {
  const allSites: SupportedSite[] = [
    'DeepSeek',
    'ChatGPT',
    'Claude',
    'Gemini',
    'Qwen',
    'Wenxin',
  ];

  it('should have all 6 adapters registered in adapterRegistry', () => {
    for (const site of allSites) {
      expect(adapterRegistry.has(site)).toBe(true);
      const adapter = adapterRegistry.get(site);
      expect(adapter).toBeDefined();
      expect(adapter?.siteName).toBe(site);
      expect(adapter?.adapterVersion).toBe('1.0.0');
    }
  });

  it('should accurately test URL patterns for all 6 sites', () => {
    expect(qwenAdapter.urlPattern.test('https://chat.qwen.ai/')).toBe(true);
    expect(qwenAdapter.urlPattern.test('https://chat.qwen.ai/c/123')).toBe(true);

    expect(wenxinAdapter.urlPattern.test('https://wenxin.baidu.com/')).toBe(true);

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

  it('qwenAdapter switches from Qwen3.8-Max to Qwen4-Max-Preview and skips when already active', async () => {
    document.body.innerHTML = `
      <header>
        <button class="model-selector" aria-haspopup="listbox">Qwen3.8-Max</button>
      </header>
      <div class="dropdown-menu" style="display:none">
        <div class="menu-list">
          <div role="option" class="model-item" data-id="qwen38">Qwen3.8-Max</div>
          <div role="option" class="model-item" data-id="qwen4max"><span>Qwen4-Max-Preview</span></div>
          <div role="option" class="model-item" data-id="qwenplus">Qwen3.5-Plus</div>
        </div>
      </div>
    `;

    const trigger = document.querySelector<HTMLElement>('.model-selector')!;
    const menu = document.querySelector<HTMLElement>('.dropdown-menu')!;
    const qwen4Item = document.querySelector<HTMLElement>('[data-id="qwen4max"]')!;
    const listWrapper = document.querySelector<HTMLElement>('.menu-list')!;

    let listClicked = false;
    let qwen4Clicked = false;
    trigger.addEventListener('click', () => {
      menu.style.display = 'block';
    });
    listWrapper.addEventListener('click', (e) => {
      if (e.target === listWrapper) listClicked = true;
    });
    qwen4Item.addEventListener('click', () => {
      qwen4Clicked = true;
      trigger.innerText = 'Qwen4-Max-Preview';
    });

    const switched = await qwenAdapter.switchModel('Qwen4-Max-Preview');
    expect(switched).toBe(true);
    expect(qwen4Clicked).toBe(true);
    expect(listClicked).toBe(false);

    // 再次调用应检测到已是 Qwen4-Max-Preview 并直接跳过，不再触发点击展开
    let triggerReclicked = false;
    trigger.addEventListener('click', () => {
      triggerReclicked = true;
    });
    const skipped = await qwenAdapter.switchModel('Qwen4-Max-Preview');
    expect(skipped).toBe(true);
    expect(triggerReclicked).toBe(false);
  });

  it('qwenAdapter ignores outer chat-message-list wrapper containing user prompt and extracts assistant reply without PROMPT_ECHO_REJECTED', () => {
    const prompt = '这是一段用于架构红队审查的超长用户提示词，包含工作流主题个性化 BaseAIConfig 与五维运行时降级技术规格说明书。';
    document.body.innerHTML = '';
    qwenAdapter.recordBaseline();
    document.body.innerHTML = `
      <div class="chat-message-list">
        <div class="chat-item-user" data-role="user">
          <div class="qwen-markdown">${prompt}</div>
        </div>
        <div class="chat-item-assistant" data-role="assistant">
          <div class="qwen-markdown">
            <h1>架构审查结论：工作流主题个性化</h1>
            <p>方案主干方向正确，以下列出 3 个核心改进建议与完整落地方案。</p>
          </div>
        </div>
      </div>
    `;

    (qwenAdapter as any).lastPrompt = prompt;
    const stopListener = qwenAdapter.listenGeneration(
      () => {},
      () => {}
    );
    const detector = (qwenAdapter as any).activeDetector;
    const current = detector.options.getCurrentContent();
    expect(current).toContain('架构审查结论：工作流主题个性化');
    expect(current).not.toContain('这是一段用于架构红队审查的超长用户提示词');
    stopListener();
  });

  it('geminiAdapter selects top-level model-response, strips model-thoughts, and merges all message-content blocks', () => {
    document.body.innerHTML = `
      <main>
        <model-response>
          <model-thoughts>
            <message-content><p>内部思维链不应该被抓取。</p></message-content>
          </model-thoughts>
          <div class="model-response-text">
            <message-content><h3>[ISS-01] 第一部分审查结论</h3><p>这里是第一段完整分析。</p></message-content>
          </div>
          <div class="model-response-text">
            <message-content><h3>[ISS-02] 第二部分审查结论</h3><p>这里是第二段完整分析。</p></message-content>
          </div>
        </model-response>
      </main>
    `;

    const stopListener = geminiAdapter.listenGeneration(
      () => {},
      () => {}
    );
    const detector = (geminiAdapter as any).activeDetector;
    const current = detector.options.getCurrentContent();
    expect(current).toContain('[ISS-01] 第一部分审查结论');
    expect(current).toContain('[ISS-02] 第二部分审查结论');
    expect(current).not.toContain('内部思维链不应该被抓取');
    stopListener();
  });

  it('chatGPTAdapter validateSubmission passes when new article renders after baseline', async () => {
    document.body.innerHTML = `<main></main>`;
    chatGPTAdapter.recordBaseline();

    document.querySelector('main')!.innerHTML = `<article data-message-author-role="user">长提示词</article>`;
    const ok = await chatGPTAdapter.validateSubmission();
    expect(ok).toBe(true);
  });

  it('chatGPTAdapter preserves full report via high-water-mark and ignores trailing 68-char chart widget overwrite', () => {
    document.body.innerHTML = '';
    chatGPTAdapter.recordBaseline();

    const longBody = '# Firefly AI Folder 发布流水线 v2.2 — 六维红队审查报告\n\n' + '详细架构剖析与风险推演结论。'.repeat(40);
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="assistant">
          <div class="markdown prose"><p>${longBody}</p></div>
        </article>
      </main>
    `;

    const stopListener = chatGPTAdapter.listenGeneration(() => {}, () => {});
    const detector = (chatGPTAdapter as any).activeDetector;
    const firstSnap = detector.options.getCurrentContent();
    expect(firstSnap.length).toBeGreaterThan(400);

    // 模拟 ChatGPT 尾部渲染一个独立图表卡片导致 DOM 突然只露出 68 字坐标轴
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="assistant">
          <div class="prose">0 2.5 5 7.5 10 架构合理性 Git/Submodule Actions触发 Release生命周期 R2一致性 操作与运维</div>
        </article>
      </main>
    `;

    const afterChartSnap = detector.options.getCurrentContent();
    expect(afterChartSnap.length).toBe(firstSnap.length);
    expect(afterChartSnap).toContain('Firefly AI Folder 发布流水线 v2.2');
    stopListener();
  });

  it('chatGPTAdapter strips trailing thinking/reasoning blocks placed after formal markdown inside article', () => {
    document.body.innerHTML = '';
    chatGPTAdapter.recordBaseline();

    document.body.innerHTML = `
      <main>
        <article>
          <div data-message-author-role="assistant">
            <div class="markdown prose">
              <h1>本地 HTTP 智能双路视频流式播放技术规格书 v1.3</h1>
              <p>这是正式的架构红队审查结论正文。</p>
            </div>
          </div>
          <div class="flex flex-col">
            <div>Thought for 1m 23s</div>
            <div class="prose"><p>这是不应被抓取的尾部思维链推演内容 A。</p></div>
          </div>
          <details data-testid="thought-summary">
            <summary>已思考 45 秒</summary>
            <div class="prose"><p>这是不应被抓取的尾部思维链推演内容 B。</p></div>
          </details>
        </article>
      </main>
    `;

    const stopListener = chatGPTAdapter.listenGeneration(() => {}, () => {});
    const detector = (chatGPTAdapter as any).activeDetector;
    const content = detector.options.getCurrentContent();
    expect(content).toContain('本地 HTTP 智能双路视频流式播放技术规格书 v1.3');
    expect(content).toContain('这是正式的架构红队审查结论正文');
    expect(content).not.toContain('尾部思维链推演内容 A');
    expect(content).not.toContain('尾部思维链推演内容 B');
    expect(content).not.toContain('Thought for 1m 23s');
    stopListener();
  });

  it('qwenAdapter ignores thinking & search markdown blocks (explicit and obfuscated) and waits for formal reply', () => {
    document.body.innerHTML = '';
    qwenAdapter.recordBaseline();

    // 阶段 1：Qwen 仅输出了漫长的搜索与思维链，尚未吐出正式正文 -> 必须返回空字符串继续守候
    document.body.innerHTML = `
      <main>
        <div class="chat-item-user" data-role="user">请对 v2.1 架构方案进行红队审查</div>
        <div class="chat-item-assistant" data-role="assistant">
          <div class="ant-collapse web-search-panel">
            <div class="qwen-markdown">联网搜索结果：正在检索相关架构文档...</div>
          </div>
          <div class="obf-wrapper">
            <div role="button" aria-expanded="true">已深度思考（用时 128 秒）</div>
            <div class="qwen-markdown">我将以资深系统架构师及严格红队评审员的身份，对待审查的架构方案进行深度解构。通过模拟对抗性思维，全面评估该方案的潜在风险与健壮性边界。</div>
          </div>
        </div>
      </main>
    `;

    const stopListener = qwenAdapter.listenGeneration(() => {}, () => {});
    const detector = (qwenAdapter as any).activeDetector;
    expect(detector.options.getCurrentContent()).toBe('');

    // 阶段 2：Qwen 思维链结束并开始渲染正式回复 -> 必须只抓取正式正文，绝不混入思维链与搜索内容
    const assistantTurn = document.querySelector('.chat-item-assistant')!;
    const formalDiv = document.createElement('div');
    formalDiv.className = 'qwen-markdown';
    formalDiv.innerHTML = '<h2>一、总体结论</h2><p>方案方向正确，但存在 3 项阻断缺陷需修订后再实施。</p>';
    assistantTurn.appendChild(formalDiv);

    const content = detector.options.getCurrentContent();
    expect(content).toContain('一、总体结论');
    expect(content).toContain('存在 3 项阻断缺陷需修订后再实施');
    expect(content).not.toContain('我将以资深系统架构师');
    expect(content).not.toContain('联网搜索结果');
    stopListener();
  });

  it('chatGPTAdapter never clicks Chinese/English voice or dictate buttons as send button', () => {
    document.body.innerHTML = `
      <form>
        <div id="prompt-textarea" contenteditable="true"><p>Hello</p></div>
        <button type="button" aria-label="上传附件"><svg></svg></button>
        <button type="button" aria-label="听写"><svg></svg></button>
        <button type="button" aria-label="启动语音模式"><svg></svg></button>
      </form>
    `;

    // 当只有语音/听写/附件按钮而没有真正发送按钮时，findSendButton 必须返回 null，严禁误点语音按钮
    expect((chatGPTAdapter as any).findSendButton()).toBeNull();

    // 当真正发送按钮出现时，必须精准命中发送按钮
    const form = document.querySelector('form')!;
    const realSend = document.createElement('button');
    realSend.setAttribute('data-testid', 'send-button');
    realSend.setAttribute('aria-label', '发送提示词');
    realSend.innerHTML = '<svg></svg>';
    form.appendChild(realSend);

    expect((chatGPTAdapter as any).findSendButton()).toBe(realSend);
  });

  it('geminiAdapter extracts formal message-content even when outer wrapper class contains thoughts', () => {
    document.body.innerHTML = '';
    geminiAdapter.recordBaseline();

    document.body.innerHTML = `
      <main>
        <model-response>
          <div class="response-container response-container-with-thoughts">
            <model-thoughts>
              <div class="thoughts-content">
                <message-content>这是内部思考过程，必须被严格剔除。</message-content>
              </div>
            </model-thoughts>
            <div class="response-container-content">
              <message-content>
                <h2>一、总体裁决与穷尽声明</h2>
                <p>这是 Gemini 正式回复正文，外层容器虽然带有 with-thoughts 类名，但绝不能被误杀过滤！</p>
              </message-content>
            </div>
          </div>
        </model-response>
      </main>
    `;

    const stopListener = geminiAdapter.listenGeneration(() => {}, () => {});
    const detector = (geminiAdapter as any).activeDetector;
    const content = detector.options.getCurrentContent();

    expect(content).toContain('一、总体裁决与穷尽声明');
    expect(content).toContain('这是 Gemini 正式回复正文');
    expect(content).not.toContain('这是内部思考过程');
    stopListener();
  });

  it('geminiAdapter createNewChat skips gem-nav-list-item and clicks real new-chat button', async () => {
    document.body.innerHTML = `
      <aside>
        <gem-nav-list-item data-test-id="new-chat-gem" id="wrong-gem">新建对话 Gem</gem-nav-list-item>
        <button data-test-id="new-chat-button" id="real-new-chat">发起新对话</button>
      </aside>
      <main>
        <model-response><message-content>已有历史消息</message-content></model-response>
      </main>
    `;

    let wrongClicked = false;
    let rightClicked = false;
    document.getElementById('wrong-gem')!.addEventListener('click', () => {
      wrongClicked = true;
    });
    document.getElementById('real-new-chat')!.addEventListener('click', () => {
      rightClicked = true;
    });

    await geminiAdapter.createNewChat();
    expect(wrongClicked).toBe(false);
    expect(rightClicked).toBe(true);
  });
});
