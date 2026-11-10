import { flightRecorder } from '../logger/flight-recorder';

/**
 * 四信号生成完成判定器
 * 1. 停止生成按钮消失
 * 2. 发送按钮就绪
 * 3. DOM 静默 ≥ 12000ms（动态阶梯式）
 * 4. 文本长度稳定且 Markdown 结构闭合
 */
export interface DoneDetectorOptions {
  getStopButton: () => HTMLElement | null;
  getSendButton: () => HTMLElement | null;
  getCurrentContent: () => string;
  onDone: (finalContent: string) => void;
  onUpdate: (currentContent: string) => void;
  silenceThresholdMs?: number;
  hardSilenceThresholdMs?: number; // 幽灵停止按钮强制解除死锁的硬静默时长，默认 15000ms
  userPrompt?: string; // 可选传入用户发送的原始提示词，用于提示词回显与角色污染防伪拦截
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
  private lastContentUpdateTime = Date.now();

  constructor(options: DoneDetectorOptions) {
    this.options = {
      silenceThresholdMs: 12000,
      hardSilenceThresholdMs: 15000,
      ...options,
    };
  }

  public start(targetElement: HTMLElement) {
    this.isCompleted = false;
    this.hasEverGenerated = false;
    this.startTime = Date.now();
    this.lastContentUpdateTime = Date.now();
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
      const currentLen = current.trim().length;

      // 仅在正文长度发生变化时才触发 onUpdate，杜绝 500ms 轮询冗余刷屏
      if (currentLen !== this.lastContentLength) {
        this.lastContentLength = currentLen;
        this.lastContentUpdateTime = Date.now();
        if (currentLen > 0) {
          this.options.onUpdate(current);
        }
        if (this.silenceTimer) {
          window.clearTimeout(this.silenceTimer);
          this.silenceTimer = null;
        }
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
      this.lastContentLength = currentLen;
      this.lastContentUpdateTime = Date.now();
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
    const sendBtn = this.options.getSendButton();
    const isStopActive = isElementActiveAndVisible(stopBtn);
    const isSendActive = isElementActiveAndVisible(sendBtn);

    // 核心判定：
    // 若可见且未被禁用的停止按钮存在，确立为正在生成中
    // 只有当发送按钮明确处于激活就绪状态，且发送按钮与停止按钮并非同一 DOM 实体时，才视为可能生成结束
    const isGenerating = isStopActive && !(sendBtn && sendBtn !== stopBtn && isSendActive);

    const content = this.options.getCurrentContent();
    const currentLen = content.trim().length;

    // 确认生成增长：若内容相比启动初始增加了 50 字符以上，确立进入过生成态
    if (currentLen - this.initialContentLength >= 50) {
      this.hasEverGenerated = true;
    }

    // 关键状态记录：一旦看见处于激活态的停止按钮，确立进入过生成态
    if (isGenerating) {
      this.hasEverGenerated = true;

      // 核心防死锁机制 (Hard Silence Override)：
      // 当处于生成态（Stop 按钮可见）时，若正文整整 hardSilenceThresholdMs (默认 15s) 以上 DOM 字符未变动一个字节，
      // 说明实际生成早已结束，残存的 Stop 按钮仅为未卸载的幽灵节点或非生成控制元素，强制解除死锁触发终审！
      const silentDurationMs = Date.now() - this.lastContentUpdateTime;
      const hardThreshold = this.options.hardSilenceThresholdMs ?? 15000;
      if (
        this.hasEverGenerated &&
        currentLen >= 100 &&
        !isThinkingOnly(content) &&
        silentDurationMs >= hardThreshold
      ) {
        flightRecorder.warn('System', 'HARD_SILENCE_FORCE_DONE', {
          finalLen: currentLen,
          silentDurationMs,
        });
        this.markDone(content);
        return;
      }

      if (this.silenceTimer) {
        window.clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
      return;
    }

    // 若还没产生任何内容，等待
    if (currentLen === 0) return;

    // 核心防提示词回显与角色污染门禁：严禁将用户输入的 Prompt 误采为回答
    if (isPromptEcho(content, this.options.userPrompt)) {
      if (this.silenceTimer) {
        window.clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
      return;
    }

    // 思考保护：如果当前内容仅仅是“正在思考”、“思考中”等占位词，绝不能判定完成
    if (isThinkingOnly(content)) {
      if (this.silenceTimer) {
        window.clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
      return;
    }

    // 核心防早熟门禁（防 15/23/42 字误裁决）：
    // 若当前字数极短（< 80字），且尚未真正经历过生成态，这必定是 TTFT 排队、骨架屏或思考慢，严禁短静默触发完成！
    const elapsedMs = Date.now() - this.startTime;
    if (currentLen < 80 && !this.hasEverGenerated && elapsedMs < 60000) {
      if (this.silenceTimer) {
        window.clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
      return;
    }

    // 信号 2 & 3：静默计时 + 长度稳定（当停止按钮消失且内容稳定 >= effectiveSilenceMs 即判定完成）
    if (!this.silenceTimer) {
      this.lastContentLength = currentLen;
      // 动态静默门禁：
      // 1. 正文极短 (<100字) 时，极可能是刚输出了标题或遇到模型流式间隙停顿，维持至少 15 秒静默，严防早熟早收敛
      // 2. 若用户/单测显式传入了 silenceThresholdMs 则优先遵从，否则默认至少 12 秒阶梯式静默
      let effectiveSilenceMs = this.options.silenceThresholdMs ?? 12000;
      if (currentLen < 100) {
        effectiveSilenceMs = Math.max(effectiveSilenceMs, 15000);
      }

      this.silenceTimer = window.setTimeout(() => {
        const latestContent = this.options.getCurrentContent();
        const latestStop = this.options.getStopButton();
        const latestSend = this.options.getSendButton();
        const stillGenerating = isElementActiveAndVisible(latestStop) && !(latestSend && latestSend !== latestStop && isElementActiveAndVisible(latestSend));

        const silentDurationMs = Date.now() - this.lastContentUpdateTime;
        const hardThreshold = this.options.hardSilenceThresholdMs ?? 15000;
        const isHardSilent = latestContent.length >= 100 && silentDurationMs >= hardThreshold;

        // 核心结构完整性校验：若 Markdown 结构明显未闭合（代码块开着、悬空标点/标题结尾），且尚未达到 25 秒极限静默超时，严禁判定完成！
        const isStructuralIncomplete = isMarkdownStructurallyIncomplete(latestContent);
        if (isStructuralIncomplete && silentDurationMs < 25000) {
          flightRecorder.warn('System', 'STRUCTURAL_INCOMPLETE_WAITING', {
            len: latestContent.length,
            silentDurationMs,
          });
          this.silenceTimer = null;
          return;
        }

        // 再次确认内容长度稳定、非思考占位词、且不再处于生成中（或已触发长文本绝对静默保底）
        if (
          !this.isCompleted &&
          latestContent.trim().length === this.lastContentLength &&
          !isThinkingOnly(latestContent) &&
          (!stillGenerating || isHardSilent)
        ) {
          // 双重确认：极短内容 (<60字) 严禁在 30 秒内触发完成
          if (latestContent.trim().length < 60 && Date.now() - this.startTime < 30000) {
            this.silenceTimer = null;
            return;
          }

          flightRecorder.info('System', 'SILENCE_TIMER_TRIGGERED_DONE', { finalLen: latestContent.length });
          this.markDone(latestContent);
        } else {
          // 长度还在变动或仍在生成中，继续等待
          this.silenceTimer = null;
        }
      }, effectiveSilenceMs);
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

export function isElementActiveAndVisible(el: HTMLElement | null): boolean {
  if (!el) return false;

  // 1. 禁用与隐藏语义属性检查
  if (el.hasAttribute('disabled')) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  if (el.getAttribute('aria-hidden') === 'true' || el.hidden) return false;
  if (el.classList.contains('disabled')) return false;

  // 2. 深度计算样式检查（防 visibility: hidden / display: none / opacity: 0 / pointer-events: none）
  if (typeof window !== 'undefined' && window.getComputedStyle) {
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none') return false;
      if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      if (parseFloat(style.opacity || '1') <= 0.05) return false;
      if (style.pointerEvents === 'none') return false;
    } catch {}
  }

  // 3. 尺寸与几何占位检查（在真实浏览器中生效；jsdom 环境下若未模拟 layout 则安全放行已连接 DOM 的元素）
  const rects = el.getClientRects ? el.getClientRects() : null;
  const hasDimensions = !!(el.offsetWidth || el.offsetHeight || (rects && rects.length > 0));
  if (!hasDimensions) {
    if (typeof window !== 'undefined' && window.document?.documentElement?.isConnected && el.isConnected) {
      const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
      if (!isJsdom) {
        return false;
      }
    } else {
      return false;
    }
  }

  return true;
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

export function isPromptEcho(content: string, userPrompt?: string): boolean {
  if (!userPrompt || userPrompt.trim().length < 30) return false;
  const pTrim = userPrompt.trim();
  const cTrim = content.trim();
  if (!cTrim) return false;

  // 1. 前缀完全重合判定（提取前 60 字符对比）
  const lead = pTrim.slice(0, 60);
  if (cTrim.startsWith(lead)) return true;

  // 2. 独有特征标签判定（如包含提示词特有标签且未包含闭合标签）
  if (pTrim.includes('<review_mandate>') && cTrim.includes('<review_mandate>') && !cTrim.includes('</review_mandate>')) {
    return true;
  }

  // 3. 长度相似且前 40 字符相同
  if (Math.abs(cTrim.length - pTrim.length) < 100 && cTrim.slice(0, 40) === pTrim.slice(0, 40)) {
    return true;
  }

  return false;
}

/**
 * 校验 Markdown 文本结构是否完整
 * 若存在未闭合代码块、悬空列表标记、未完成标题、悬空标点符号，判定为尚未生成完毕
 */
export function isMarkdownStructurallyIncomplete(text: string): boolean {
  if (!text || text.trim().length === 0) return true;
  const trimmed = text.trim();

  // 1. 检查三反引号代码块未闭合：``` 数量为奇数
  const backtickMatches = trimmed.match(/```/g);
  if (backtickMatches && backtickMatches.length % 2 !== 0) {
    return true;
  }

  // 2. 检查波浪号代码块未闭合：~~~ 数量为奇数
  const tildeMatches = trimmed.match(/~~~/g);
  if (tildeMatches && tildeMatches.length % 2 !== 0) {
    return true;
  }

  // 3. 检查行尾悬空语法
  const lines = trimmed.split('\n');
  const lastLine = (lines[lines.length - 1] || '').trim();

  // 标题行悬空：如以 '#' 或 '###' 结尾，或者只写了 '### ' 还没写标题内容
  if (/^#{1,6}\s*$/.test(lastLine)) {
    return true;
  }

  // 列表标记悬空：如以 '- ', '* ', '+ ', '1. ', '1) ' 结尾且无正文
  if (/^(\d+[\.\)]|[\-\*\+])\s*$/.test(lastLine)) {
    return true;
  }

  // 未闭合的行内加粗或斜体标记：末尾以 '*' 或 '**' 或 '__' 结尾
  if (/(?<!\*)\*{1,2}$/.test(lastLine) && !/\*{3,}$/.test(lastLine)) {
    return true;
  }
  if (/(?<!_)_{1,2}$/.test(lastLine) && !/_{3,}$/.test(lastLine)) {
    return true;
  }

  // 明显的悬空标点符号或连词结尾（正文在逗号、冒号、顿号、未闭合括号处戛然而止）
  // 注意：不包含 Markdown 表格末尾的 '|'
  if (/[，,：:、\(（\[【“"\\—…]$/.test(lastLine)) {
    return true;
  }

  return false;
}
