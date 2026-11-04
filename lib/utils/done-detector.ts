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
      silenceThresholdMs: 2000,
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

    // 2. 轮询检查按钮状态（防止极端情况下 mutation 丢失）
    this.pollInterval = window.setInterval(() => {
      if (this.isCompleted) return;
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

    // 信号 2：检查发送按钮是否已处于可用状态
    const sendBtn = this.options.getSendButton();
    const isSendReady = sendBtn !== null && isVisible(sendBtn) && !sendBtn.hasAttribute('disabled');

    const content = this.options.getCurrentContent();
    const currentLen = content.trim().length;

    // 若还没产生任何内容，等待
    if (currentLen === 0) return;

    // 信号 3 & 4：静默计时 + 长度稳定
    if (!this.silenceTimer) {
      this.lastContentLength = currentLen;
      this.silenceTimer = window.setTimeout(() => {
        const latestContent = this.options.getCurrentContent();
        // 再次确认内容长度稳定且非生成中
        if (
          !this.isCompleted &&
          latestContent.trim().length === this.lastContentLength &&
          !isVisible(this.options.getStopButton())
        ) {
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
