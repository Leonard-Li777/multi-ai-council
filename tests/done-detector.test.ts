// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isElementActiveAndVisible, QuadSignalDoneDetector, isMarkdownStructurallyIncomplete } from '../lib/utils/done-detector';

describe('QuadSignalDoneDetector & isElementActiveAndVisible', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('isElementActiveAndVisible', () => {
    it('returns false for null element', () => {
      expect(isElementActiveAndVisible(null)).toBe(false);
    });

    it('returns false for disabled element', () => {
      const btn = document.createElement('button');
      btn.disabled = true;
      document.body.appendChild(btn);
      expect(isElementActiveAndVisible(btn)).toBe(false);
    });

    it('returns false for aria-disabled element', () => {
      const btn = document.createElement('button');
      btn.setAttribute('aria-disabled', 'true');
      document.body.appendChild(btn);
      expect(isElementActiveAndVisible(btn)).toBe(false);
    });

    it('returns false for hidden or aria-hidden element', () => {
      const btn1 = document.createElement('button');
      btn1.hidden = true;
      document.body.appendChild(btn1);
      expect(isElementActiveAndVisible(btn1)).toBe(false);

      const btn2 = document.createElement('button');
      btn2.setAttribute('aria-hidden', 'true');
      document.body.appendChild(btn2);
      expect(isElementActiveAndVisible(btn2)).toBe(false);
    });

    it('returns false for element with disabled class', () => {
      const btn = document.createElement('button');
      btn.className = 'btn disabled';
      document.body.appendChild(btn);
      expect(isElementActiveAndVisible(btn)).toBe(false);
    });

    it('returns false for element with display: none or visibility: hidden or opacity: 0', () => {
      const btn1 = document.createElement('button');
      btn1.style.display = 'none';
      document.body.appendChild(btn1);
      expect(isElementActiveAndVisible(btn1)).toBe(false);

      const btn2 = document.createElement('button');
      btn2.style.visibility = 'hidden';
      document.body.appendChild(btn2);
      expect(isElementActiveAndVisible(btn2)).toBe(false);

      const btn3 = document.createElement('button');
      btn3.style.opacity = '0';
      document.body.appendChild(btn3);
      expect(isElementActiveAndVisible(btn3)).toBe(false);
    });

    it('returns true for active, attached button', () => {
      const btn = document.createElement('button');
      btn.innerText = 'Send';
      document.body.appendChild(btn);
      expect(isElementActiveAndVisible(btn)).toBe(true);
    });
  });

  describe('QuadSignalDoneDetector convergence logic', () => {
    it('successfully converges to DONE for long content when stop button is disabled and content is stable', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const stopBtn = document.createElement('button');
      stopBtn.setAttribute('aria-label', 'Stop');
      document.body.appendChild(stopBtn);

      const sendBtn = document.createElement('button');
      sendBtn.setAttribute('aria-label', 'Send');
      document.body.appendChild(sendBtn);

      let currentContent = '这是长篇规格说明书审查评估报告，字数已经大幅超过一百字符以满足稳定与收敛条件。我们对架构设计、接口一致性、高并发容灾、回滚策略以及各类边界场景进行了全方位的盲审与代码事实核验，各项指标均已达到交付基线。';
      let doneResult = '';
      const onDone = vi.fn((content: string) => {
        doneResult = content;
      });
      const onUpdate = vi.fn();

      const detector = new QuadSignalDoneDetector({
        getStopButton: () => stopBtn,
        getSendButton: () => sendBtn,
        getCurrentContent: () => currentContent,
        onDone,
        onUpdate,
        silenceThresholdMs: 2000,
      });

      detector.start(container);

      // 阶段 1：生成中（stopBtn 处于启用态，sendBtn 处于禁用态）
      sendBtn.disabled = true;
      stopBtn.disabled = false;

      // 前进 1 秒，确认未触发 done
      vi.advanceTimersByTime(1000);
      expect(onDone).not.toHaveBeenCalled();

      // 阶段 2：生成结束（stopBtn 被禁用，sendBtn 恢复可用）
      stopBtn.disabled = true;
      sendBtn.disabled = false;

      // 前进 2500ms（大于 silenceThresholdMs: 2000ms）
      vi.advanceTimersByTime(2500);

      expect(onDone).toHaveBeenCalledTimes(1);
      expect(doneResult).toContain('这是长篇规格说明书审查评估报告');

      detector.destroy();
    });

    it('enforces longer silence period for short content (<100 chars) to prevent premature convergence', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const stopBtn = document.createElement('button');
      document.body.appendChild(stopBtn);
      stopBtn.disabled = true;

      const sendBtn = document.createElement('button');
      document.body.appendChild(sendBtn);
      sendBtn.disabled = false;

      // 模拟仅输出了 42 字符的开头标题（如“# 外部红队审查结论报告 ## 一、首尾双锚定唤醒自检 - **系统底线契约”）
      const shortContent = '# 外部红队审查结论报告 ## 一、首尾双锚定唤醒自检 - **系统底线契约';
      const onDone = vi.fn();

      const detector = new QuadSignalDoneDetector({
        getStopButton: () => stopBtn,
        getSendButton: () => sendBtn,
        getCurrentContent: () => shortContent,
        onDone,
        onUpdate: vi.fn(),
        silenceThresholdMs: 2000,
      });

      detector.start(container);

      // 短暂静默 2500ms：短字数门禁必须拦截，严禁触发 done！
      vi.advanceTimersByTime(2500);
      expect(onDone).not.toHaveBeenCalled();

      // 经历长静默并超过 60s 安全排队宽限期后才允许兜底完成 (60s 排队 + 15s 观察)
      vi.advanceTimersByTime(80000);
      expect(onDone).toHaveBeenCalledTimes(1);

      detector.destroy();
    });

    it('does not converge prematurely during active generation even if silence threshold passes', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const stopBtn = document.createElement('button');
      stopBtn.setAttribute('aria-label', 'Stop');
      document.body.appendChild(stopBtn);

      const sendBtn = document.createElement('button');
      sendBtn.disabled = true;
      document.body.appendChild(sendBtn);

      let currentContent = '正在生成中的内容，字数虽多但停止按钮一直亮着...';
      const onDone = vi.fn();
      const onUpdate = vi.fn();

      const detector = new QuadSignalDoneDetector({
        getStopButton: () => stopBtn,
        getSendButton: () => sendBtn,
        getCurrentContent: () => currentContent,
        onDone,
        onUpdate,
        silenceThresholdMs: 2000,
      });

      detector.start(container);

      // 前进 3000ms，因为 stopBtn 处于激活可用状态，判定器严禁收敛
      vi.advanceTimersByTime(3000);
      expect(onDone).not.toHaveBeenCalled();

      detector.destroy();
    });

    it('triggers HARD_SILENCE_FORCE_DONE for long text (>100 chars) when stop button is stuck active but text remains silent for 8s', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      // 模拟幽灵停止按钮（如 Gemini 页面残留或未销毁的 TTS/控制按钮）
      const phantomStopBtn = document.createElement('button');
      phantomStopBtn.setAttribute('aria-label', 'Stop response');
      phantomStopBtn.disabled = false;
      document.body.appendChild(phantomStopBtn);

      const sendBtn = document.createElement('button');
      sendBtn.setAttribute('aria-label', 'Send message');
      sendBtn.setAttribute('aria-disabled', 'true'); // 输入框为空，发送按钮不可用
      document.body.appendChild(sendBtn);

      const longContent = '## 规格说明书审查评估报告\n\n经深度通盘推演与全量代码事实核验，当前多模型协同插件已实现双轨网络与DOM伴生流式收敛。全量接口签名与数据拓扑均已核验无误，具备极高的鲁棒性与工业级容灾能力，完全符合交付标准并具备极佳的代码可维护性。';
      expect(longContent.length).toBeGreaterThan(100);

      const onDone = vi.fn();
      const detector = new QuadSignalDoneDetector({
        getStopButton: () => phantomStopBtn,
        getSendButton: () => sendBtn,
        getCurrentContent: () => longContent,
        onDone,
        onUpdate: vi.fn(),
        silenceThresholdMs: 2000,
        hardSilenceThresholdMs: 8000,
      });

      detector.start(container);

      // 前进 5 秒：虽然大于 silenceThresholdMs(2000)，但因停止按钮激活，尚未达到 8 秒硬超时
      vi.advanceTimersByTime(5000);
      expect(onDone).not.toHaveBeenCalled();

      // 前进到 8.5 秒：硬静默防死锁门禁触发，强制解除死锁终审！
      vi.advanceTimersByTime(3500);
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(onDone).toHaveBeenCalledWith(longContent);

      detector.destroy();
    });

    it('rejects prompt echo and prevents premature done when captured content echoes user prompt', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const stopBtn = document.createElement('button');
      stopBtn.disabled = true;
      document.body.appendChild(stopBtn);

      const sendBtn = document.createElement('button');
      sendBtn.disabled = false;
      document.body.appendChild(sendBtn);

      const userPrompt = '# 桌面端全流程自动化测试规格书外部专家红队盲审提示词 (External Review Prompt)\n\n<review_mandate>你是一名顶级专家，请全面穷尽推演并发漏洞与边界缺陷。</review_mandate>';
      // 模拟误采到用户提示词
      const echoedContent = userPrompt;

      const onDone = vi.fn();
      const detector = new QuadSignalDoneDetector({
        getStopButton: () => stopBtn,
        getSendButton: () => sendBtn,
        getCurrentContent: () => echoedContent,
        onDone,
        onUpdate: vi.fn(),
        silenceThresholdMs: 2000,
        userPrompt,
      });

      detector.start(container);

      // 无论静默多久，提示词回显坚决不触发完成！
      vi.advanceTimersByTime(5000);
      expect(onDone).not.toHaveBeenCalled();

      vi.advanceTimersByTime(30000);
      expect(onDone).not.toHaveBeenCalled();

      detector.destroy();
    });

    it('prevents completion when Markdown code block is unclosed', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const stopBtn = document.createElement('button');
      stopBtn.disabled = true;
      document.body.appendChild(stopBtn);

      const sendBtn = document.createElement('button');
      sendBtn.disabled = false;
      document.body.appendChild(sendBtn);

      // 代码块未闭合（奇数个 ```）
      const unclosedContent = '## 审查评估报告\n\n```typescript\nfunction test() {\n  return 42;\n';
      const onDone = vi.fn();
      const detector = new QuadSignalDoneDetector({
        getStopButton: () => stopBtn,
        getSendButton: () => sendBtn,
        getCurrentContent: () => unclosedContent,
        onDone,
        onUpdate: vi.fn(),
        silenceThresholdMs: 2000,
      });

      detector.start(container);

      // 超过 2000ms 静默，但因代码块未闭合，严禁判定完成！
      vi.advanceTimersByTime(3000);
      expect(onDone).not.toHaveBeenCalled();

      // 在 25s 极限保护内依然保持守候
      vi.advanceTimersByTime(10000);
      expect(onDone).not.toHaveBeenCalled();

      detector.destroy();
    });
  });

  describe('isMarkdownStructurallyIncomplete', () => {
    it('detects unclosed code blocks', () => {
      expect(isMarkdownStructurallyIncomplete('```typescript\nconsole.log(1);')).toBe(true);
      expect(isMarkdownStructurallyIncomplete('```typescript\nconsole.log(1);\n```')).toBe(false);
      expect(isMarkdownStructurallyIncomplete('```ts\na\n```\n```ts\nb')).toBe(true);
      expect(isMarkdownStructurallyIncomplete('```ts\na\n```\n```ts\nb\n```')).toBe(false);
    });

    it('detects hanging headings and list markers', () => {
      expect(isMarkdownStructurallyIncomplete('# 标题一\n### ')).toBe(true);
      expect(isMarkdownStructurallyIncomplete('# 标题一\n### 标题二')).toBe(false);
      expect(isMarkdownStructurallyIncomplete('清单：\n- ')).toBe(true);
      expect(isMarkdownStructurallyIncomplete('清单：\n- 第一项')).toBe(false);
      expect(isMarkdownStructurallyIncomplete('步骤：\n1. ')).toBe(true);
      expect(isMarkdownStructurallyIncomplete('步骤：\n1. 执行第一步')).toBe(false);
    });

    it('detects hanging punctuation', () => {
      expect(isMarkdownStructurallyIncomplete('缺陷如下：')).toBe(true);
      expect(isMarkdownStructurallyIncomplete('缺陷如下，')).toBe(true);
      expect(isMarkdownStructurallyIncomplete('缺陷如下（')).toBe(true);
      expect(isMarkdownStructurallyIncomplete('缺陷如下。')).toBe(false);
      expect(isMarkdownStructurallyIncomplete('| 列1 | 列2 |')).toBe(false);
    });
  });
});
