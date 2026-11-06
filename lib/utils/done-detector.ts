import { flightRecorder } from '../logger/flight-recorder';

/**
 * 四信号生成完成判定器
 * 1. 停止生成按钮消失
 * 2. 发送按钮就绪
 * 3. DOM 静默 ≥ 2000ms
 * 4. 文本长度稳定
 */
export interface DoneDetectorOptions {
  getStopButton: () => HTMLElement | null;
  getSendButton: () => HTMLElement | null;
  getCurrentContent: () => string;
  onDone: (finalContent: string) => void;
  onUpdate: (currentContent: string) => void;
  silenceThresholdMs?: number;
}

export class QuadSignalDoneDetector {
  private options: DoneDetectorOptions;
  private silenceTimer: number | null = null;
  private lastContentLength = 0;
  private isCompleted = false;
  private observer: MutationObserver | null = null;
  private pollInterval: number | null = null;

  constructor(options: DoneDetectorOptions) {
    this.options = {
      silenceThresholdMs: 2500,
      ...options,
    };
  }

  public start(targetElement: HTMLElement) {
    this.isCompleted = false;
    this.lastContentLength = 0;

    // 1. 启动 DOM Mutation 监听
    this.observer = new MutationObserver(() => {
      if (this.isCompleted) return;
      this.handleMutation();
    });

    this.observer.observe(targetElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // 2. 轮询检查按钮状态与内容快照（双重兜底，防止极端情况下 DOM Mutation 漏报）
    this.pollInterval = window.setInterval(() => {
      if (this.isCompleted) return;
      const current = this.options.getCurrentContent();
      if (current.trim().length > 0) {
        this.options.onUpdate(current);
      }
      this.checkSignals();
    }, 500);
  }

  private handleMutation() {
    const current = this.options.getCurrentContent();
    this.options.onUpdate(current);

    // 重置静默计时器
    if (this.silenceTimer) {
      window.clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    this.checkSignals();
  }

  private checkSignals() {
    const stopBtn = this.options.getStopButton();
    const isGenerating = stopBtn !== null && isVisible(stopBtn);

    // 信号 1：若仍有停止按钮，坚决不判定完成
    if (isGenerating) {
      if (this.silenceTimer) {
        window.clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
      return;
    }

    const content = this.options.getCurrentContent();
    const currentLen = content.trim().length;

    // 若还没产生任何内容，等待
    if (currentLen === 0) return;

    // 思考保护：如果当前内容仅仅是“正在思考”、“思考中”等占位词，绝不能判定完成
    if (isThinkingOnly(content)) {
      if (this.silenceTimer) {
        window.clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
      return;
    }

    // 信号 2 & 3：静默计时 + 长度稳定（当停止按钮消失且内容稳定 >= silenceThresholdMs 即判定完成）
    if (!this.silenceTimer) {
      this.lastContentLength = currentLen;
      flightRecorder.info('System', 'SILENCE_TIMER_START', { len: currentLen, ms: this.options.silenceThresholdMs });
      this.silenceTimer = window.setTimeout(() => {
        const latestContent = this.options.getCurrentContent();
        // 再次确认内容长度稳定、非思考占位词、且停止按钮确实不存在
        if (
          !this.isCompleted &&
          latestContent.trim().length === this.lastContentLength &&
          !isThinkingOnly(latestContent) &&
          !isVisible(this.options.getStopButton())
        ) {
          flightRecorder.info('System', 'SILENCE_TIMER_TRIGGERED_DONE', { finalLen: latestContent.length });
          this.markDone(latestContent);
        } else {
          // 长度还在变动，继续等待
          this.silenceTimer = null;
        }
      }, this.options.silenceThresholdMs);
    }
  }

  private markDone(finalContent: string) {
    if (this.isCompleted) return;
    this.isCompleted = true;
    this.destroy();
    this.options.onDone(finalContent);
  }

  public destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.silenceTimer) {
      window.clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.pollInterval) {
      window.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}

function isVisible(el: HTMLElement | null): boolean {
  if (!el) return false;
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

function isThinkingOnly(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[\s\.\:\…\-\_\,\，\。]/g, '');
  return (
    t === '正在思考' ||
    t === '思考中' ||
    t === '深度思考中' ||
    t === 'thinking' ||
    t === 'thought' ||
    t === 'reasoning' ||
    t === '正在思考中' ||
    t === '正在生成' ||
    (t.startsWith('正在思考') && t.length <= 8)
  );
}
