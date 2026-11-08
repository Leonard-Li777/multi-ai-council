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
  // 是否真正进入过生成态（见过停止按钮，或内容产生过明显递增）
  private hasEverGenerated = false;
  private initialContentLength = 0;
  private startTime = Date.now();

  constructor(options: DoneDetectorOptions) {
    this.options = {
      silenceThresholdMs: 4500,
      ...options,
    };
  }

  public start(targetElement: HTMLElement) {
    this.isCompleted = false;
    this.hasEverGenerated = false;
    this.startTime = Date.now();
    const initial = this.options.getCurrentContent().trim();
    this.initialContentLength = initial.length;
    this.lastContentLength = this.initialContentLength;

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
    const currentLen = current.trim().length;

    // 关键防抖与防打断：只有当正文文本发生实质变化时，才通知更新并重置静默定时器
    // 杜绝光标闪烁、CSS 动画微动不断打断 silenceTimer 导致永远无法收敛为 DONE
    if (currentLen !== this.lastContentLength) {
      if (currentLen > 0) {
        this.options.onUpdate(current);
      }
      if (this.silenceTimer) {
        window.clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
    }

    this.checkSignals();
  }

  private checkSignals() {
    const stopBtn = this.options.getStopButton();
    const isGenerating = stopBtn !== null && isVisible(stopBtn);

    // 关键状态记录：一旦看见可见的停止按钮，确立进入过生成态
    if (isGenerating) {
      this.hasEverGenerated = true;
      if (this.silenceTimer) {
        window.clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
      return;
    }

    const content = this.options.getCurrentContent();
    const currentLen = content.trim().length;

    // 确认生成增长：若内容相比启动初始增加了 50 字符以上，确立进入过生成态
    if (currentLen - this.initialContentLength >= 50) {
      this.hasEverGenerated = true;
    }

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

    // 核心防早熟门禁（防 15/23 字误裁决）：
    // 若当前字数极短（< 60字），且尚未真正经历过生成态，这必定是 TTFT 排队、骨架屏或思考头，严禁短静默触发完成！
    const elapsedMs = Date.now() - this.startTime;
    if (currentLen < 60 && !this.hasEverGenerated && elapsedMs < 20000) {
      if (this.silenceTimer) {
        window.clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
      return;
    }

    // 信号 2 & 3：静默计时 + 长度稳定（当停止按钮消失且内容稳定 >= silenceThresholdMs 即判定完成）
    if (!this.silenceTimer) {
      this.lastContentLength = currentLen;
      this.silenceTimer = window.setTimeout(() => {
        const latestContent = this.options.getCurrentContent();
        // 再次确认内容长度稳定、非思考占位词、且停止按钮确实不存在
        if (
          !this.isCompleted &&
          latestContent.trim().length === this.lastContentLength &&
          !isThinkingOnly(latestContent) &&
          !isVisible(this.options.getStopButton())
        ) {
          // 双重确认：极短内容必须满足安全宽限时间或发送按钮恢复就绪
          const sendBtn = this.options.getSendButton();
          const isSendActive = sendBtn !== null && !sendBtn.hasAttribute('disabled') && sendBtn.getAttribute('aria-disabled') !== 'true';
          if (latestContent.trim().length < 60 && !isSendActive && Date.now() - this.startTime < 20000) {
            this.silenceTimer = null;
            return;
          }

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
  const t = text.trim().toLowerCase().replace(/[\s\.\:\…\-\_\,\，\。\(\)\（\）\【\】\[\]]/g, '');
  if (!t) return true;
  return (
    t === '正在思考' ||
    t === '思考中' ||
    t === '深度思考中' ||
    t === '已完成思考' ||
    t === '已经完成思考' ||
    t === '思考完成' ||
    t === '思考完毕' ||
    t === '思考过程' ||
    t === 'thinking' ||
    t === 'thought' ||
    t === 'reasoning' ||
    t === 'thinkingprocess' ||
    t === 'thoughtprocess' ||
    t === '正在思考中' ||
    t === '正在生成' ||
    (t.includes('完成思考') && t.length <= 25) ||
    (t.includes('思考过程') && t.length <= 25) ||
    (t.startsWith('正在思考') && t.length <= 25) ||
    (t.startsWith('深度思考') && t.length <= 25) ||
    (t.startsWith('thoughtfor') && t.length <= 30) ||
    (t.startsWith('thinking') && t.length <= 25) ||
    (t.includes('思考') && t.length <= 15)
  );
}
