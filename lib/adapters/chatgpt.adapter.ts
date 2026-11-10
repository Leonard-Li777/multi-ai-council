import type { AISiteAdapter } from './base';
import { adapterRegistry } from './base';
import type { SupportedSite } from '../types/review-job';
import { simulateTextInput } from '../utils/insert-text';
import { stripThinkBlocks } from '../utils/think-block-strip';
import { domToMarkdown } from '../utils/dom-to-markdown';
import { QuadSignalDoneDetector } from '../utils/done-detector';
import { isLoginButtonPresent } from '../utils/dom-checker';
import { flightRecorder } from '../logger/flight-recorder';

export class ChatGPTAdapter implements AISiteAdapter {
  public readonly siteName: SupportedSite = 'ChatGPT';
  public readonly urlPattern = /^https:\/\/chatgpt\.com(\/.*)?$/;
  public readonly adapterVersion = '1.0.0';

  private activeDetector: QuadSignalDoneDetector | null = null;
  private currentSnapshot = '';
  private baselineLastElement: HTMLElement | null = null;
  private baselineLastContent = '';

  public recordBaseline(): void {
    const el = this.findLatestAssistantMessageElement();
    this.baselineLastElement = el;
    this.baselineLastContent = el ? (domToMarkdown(el) || el.innerText || el.textContent || '').trim() : '';
  }

  /**
   * 检查页面是否就绪（ProseMirror 输入框是否加载）
   */
  public async isReady(): Promise<boolean> {
    const input = this.findInputElement();
    return input !== null;
  }

  /**
   * 检查阻断状态（Cloudflare 验证码、未登录、限流等）
   */
  public async checkBlocker(): Promise<'OK' | 'CAPTCHA' | 'RATE_LIMIT' | 'NOT_LOGGED_IN' | 'DOM_CHANGED'> {
    // 1. 若输入框已存在，说明处于聊天状态，绝非未登录
    const input = this.findInputElement();
    if (input) {
      const captcha = document.querySelector(
        'iframe[src*="challenges.cloudflare.com"], #challenge-running, div[class*="turnstile"], div[id*="cf-challenge"]'
      );
      if (captcha) return 'CAPTCHA';
      return 'OK';
    }

    // 2. Cloudflare 质询 / Turnstile
    const captcha = document.querySelector(
      'iframe[src*="challenges.cloudflare.com"], #challenge-running, div[class*="turnstile"], div[id*="cf-challenge"]'
    );
    if (captcha) return 'CAPTCHA';

    // 3. 未登录检查（特定 URL 或登录按钮）
    if (
      window.location.pathname.includes('/auth') ||
      window.location.pathname.includes('/login') ||
      isLoginButtonPresent('button[data-testid="login-button"], a[href*="/auth/login"], button, a')
    ) {
      return 'NOT_LOGGED_IN';
    }

    // 4. 限流 / 异常提示检查
    const errorBanner = document.querySelector(
      'div[class*="text-token-text-error"], div[data-testid*="error"]'
    );
    if (errorBanner) {
      const errorText = errorBanner.textContent?.toLowerCase() || '';
      if (errorText.includes('rate limit') || errorText.includes('too many requests') || errorText.includes('capacity')) {
        return 'RATE_LIMIT';
      }
    }

    return 'DOM_CHANGED';
  }

  /**
   * 检查页面当前是否已存在历史消息
   */
  public hasExistingMessages(): boolean {
    const msgs = document.querySelectorAll(
      'article, div[data-message-author-role="assistant"], div[class*="agent-turn"]'
    );
    return msgs.length > 0;
  }

  /**
   * 开启新会话
   */
  public async createNewChat(force = false): Promise<void> {
    // 若当前已经是根路径且非强制唤醒，本身即为全新会话，无需触发导航
    if (!force && (window.location.pathname === '/' || window.location.pathname === '')) {
      return;
    }

    const allCandidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, a, div[role="button"], span[role="button"]'
      )
    );
    const newChatBtn = allCandidates.find((el) => {
      const isLogo = el.classList.contains('logo') || el.closest('[class*="logo"]') !== null;
      if (isLogo) return false;
      const text = (el.innerText || el.textContent || '').trim().toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
      const testid = (el.getAttribute('data-testid') || '').toLowerCase();
      return (
        testid.includes('create-new-chat') ||
        testid.includes('new-chat') ||
        text === 'new chat' ||
        text === '新聊天' ||
        text === '新对话' ||
        aria.includes('new chat') ||
        aria.includes('新聊天') ||
        aria.includes('新对话')
      );
    });

    if (newChatBtn) {
      newChatBtn.click();
      await this.sleep(600);
    }
  }

  /**
   * 获取当前会话远程 URL
   */
  public getConversationUrl(): string {
    return window.location.href;
  }

  /**
   * 注入提示词并点击发送（攻坚 ProseMirror 受控组件与剪贴板模拟）
   */
  public async sendPrompt(prompt: string): Promise<boolean> {
    this.recordBaseline();

    // 1. 轮询等待真实可交互输入框就绪 (最多等待 15 秒)
    // 严禁将 SSR 阶段的 #pending-home-input 占位符当作最终就绪输入框
    let input: HTMLElement | null = null;
    for (let i = 0; i < 75; i++) {
      const el = this.findInputElement();
      if (el && el.isConnected) {
        input = el;
        break;
      }

      // 若命中了 ChatGPT 首页的 pending 占位 textarea，主动点击唤醒真实 ProseMirror 挂载
      const pending = document.querySelector<HTMLElement>('#pending-home-input, textarea[data-id="root"]');
      if (pending) {
        pending.focus();
        pending.click();
        pending.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        pending.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        pending.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }

      // 每隔 2 秒尝试触发一次创建新会话以强制唤醒聊天主视窗
      if (i > 0 && i % 10 === 0) {
        await this.createNewChat(true);
      }

      await this.sleep(200);
    }

    if (!input) {
      flightRecorder.error('ChatGPT', 'INPUT_NOT_FOUND_AFTER_POLLING');
      console.error('[ChatGPTAdapter] Input element not found after polling');
      return false;
    }

    flightRecorder.info('ChatGPT', 'INPUT_FOUND', { tag: input.tagName, id: input.id });

    // 2. 模拟写入 ProseMirror 富文本或标准 textarea
    input.focus();
    let injected = false;
    try {
      injected = await simulateTextInput(input, prompt);
    } catch {}

    // 若模拟写入未生效或为空，根据元素类型分别执行严格注入保底
    const currentVal = input instanceof HTMLTextAreaElement ? input.value : (input.textContent || '');
    if (!injected || currentVal.trim().length === 0) {
      if (input instanceof HTMLTextAreaElement) {
        input.value = prompt;
        input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: prompt }));
        input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: prompt }));
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      } else {
        let p = input.querySelector('p');
        if (!p) {
          p = document.createElement('p');
          input.innerHTML = '';
          input.appendChild(p);
        }
        p.textContent = prompt;
        input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: prompt }));
        input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: prompt }));
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      }
      injected = true;
      flightRecorder.info('ChatGPT', 'PROMPT_INJECT_FALLBACK_TREE', { promptLength: prompt.length });
    } else {
      flightRecorder.info('ChatGPT', 'PROMPT_INJECT_SUCCESS', { promptLength: prompt.length });
    }

    await this.sleep(300);

    // 3. 轮询等待 React/ProseMirror 渲染并解禁发送按钮 (最多 3 秒)
    let submitted = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      await this.sleep(200);

      // 若已经出现真正的停止按钮，说明已成功进入生成
      if (this.findStopButton()) {
        submitted = true;
        flightRecorder.info('ChatGPT', 'STOP_BUTTON_ALREADY_PRESENT');
        break;
      }

      const sendBtn = this.findSendButton();
      if (sendBtn) {
        const isAriaDisabled = sendBtn.getAttribute('aria-disabled') === 'true';
        const isDisabled = sendBtn.hasAttribute('disabled') || isAriaDisabled;
        if (!isDisabled) {
          sendBtn.click();
          submitted = true;
          flightRecorder.info('ChatGPT', 'SEND_BUTTON_CLICKED', { attempt });
          await this.sleep(800);
          break;
        } else if (attempt >= 5) {
          // 若 1s 后依然 aria-disabled，强行解除限制并触发点击
          sendBtn.removeAttribute('disabled');
          sendBtn.setAttribute('aria-disabled', 'false');
          sendBtn.click();
          submitted = true;
          flightRecorder.warn('ChatGPT', 'SEND_BUTTON_FORCE_CLICKED', { attempt });
          await this.sleep(800);
          break;
        }
      }
    }

    // 4. 单通道互斥保底：仅在未成功点击发送按钮且未检测到停止按钮时，才尝试派发单次 Enter 键盘事件！
    // 坚决杜绝 form.requestSubmit() 与多次并发派发 Enter，彻底解决 Next.js/ProseMirror 并发踩踏卡死页面！
    if (!submitted && !this.findStopButton()) {
      input.focus();
      const enterInit: KeyboardEventInit = {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true,
      };
      input.dispatchEvent(new KeyboardEvent('keydown', enterInit));
      input.dispatchEvent(new KeyboardEvent('keypress', enterInit));
      input.dispatchEvent(new KeyboardEvent('keyup', enterInit));
      flightRecorder.info('ChatGPT', 'ENTER_KEY_DISPATCHED');
      await this.sleep(500);
    }

    return true;
  }

  /**
   * 验证消息是否提交成功
   */
  public async validateSubmission(): Promise<boolean> {
    for (let i = 0; i < 15; i++) {
      await this.sleep(400);
      const stopBtn = this.findStopButton();
      if (stopBtn) {
        flightRecorder.info('ChatGPT', 'VALIDATE_SUBMISSION_PASS', { reason: 'STOP_BUTTON_DETECTED' });
        return true;
      }

      // 检查是否已经产生新的回答容器
      const lastMsg = this.findLatestAssistantMessageElement();
      if (lastMsg && lastMsg !== this.baselineLastElement) {
        flightRecorder.info('ChatGPT', 'VALIDATE_SUBMISSION_PASS', { reason: 'NEW_ASSISTANT_MESSAGE_DETECTED' });
        return true;
      }

      // 检查 URL 是否发生改变（例如从 / 变为 /c/<uuid>）
      if (window.location.pathname.startsWith('/c/')) {
        flightRecorder.info('ChatGPT', 'VALIDATE_SUBMISSION_PASS', { reason: 'CONVERSATION_URL_CREATED' });
        return true;
      }

      const input = this.findInputElement();
      if (input) {
        const val = input instanceof HTMLTextAreaElement ? input.value : (input.innerText || input.textContent || '');
        // 只有当至少经历了两轮轮询 (i >= 2) 且输入框被清空时才视为提交完成
        if (val.trim().length === 0 && i >= 2) {
          flightRecorder.info('ChatGPT', 'VALIDATE_SUBMISSION_PASS', { reason: 'INPUT_CLEARED' });
          return true;
        }
      }
    }

    // 最终检查：若依然有 stop 按钮则判定成功
    if (this.findStopButton()) {
      flightRecorder.info('ChatGPT', 'VALIDATE_SUBMISSION_PASS', { reason: 'FINAL_STOP_BUTTON_DETECTED' });
      return true;
    }

    // 检查是否有新的回答容器
    const finalLastMsg = this.findLatestAssistantMessageElement();
    if (finalLastMsg && finalLastMsg !== this.baselineLastElement) {
      flightRecorder.info('ChatGPT', 'VALIDATE_SUBMISSION_PASS', { reason: 'FINAL_NEW_ASSISTANT_MESSAGE_DETECTED' });
      return true;
    }

    // 若输入框已被清空也判定成功
    const finalInput = this.findInputElement();
    if (finalInput) {
      const val = finalInput instanceof HTMLTextAreaElement ? finalInput.value : (finalInput.innerText || finalInput.textContent || '');
      if (val.trim().length === 0) {
        flightRecorder.info('ChatGPT', 'VALIDATE_SUBMISSION_PASS', { reason: 'FINAL_INPUT_CLEARED' });
        return true;
      }
    }

    // 唯一单次温和补发兜底：仅在经过整整 6 秒无响应且依然处于未发送时尝试单次 Enter，严禁循环内频繁轰炸
    if (finalInput) {
      flightRecorder.warn('ChatGPT', 'VALIDATE_SUBMISSION_RETRY_ENTER_ONCE');
      finalInput.focus();
      const eventInit: KeyboardEventInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
      finalInput.dispatchEvent(new KeyboardEvent('keydown', eventInit));
      finalInput.dispatchEvent(new KeyboardEvent('keypress', eventInit));
      finalInput.dispatchEvent(new KeyboardEvent('keyup', eventInit));
      await this.sleep(1000);
      if (this.findStopButton() || window.location.pathname.startsWith('/c/')) {
        return true;
      }
    }

    flightRecorder.warn('ChatGPT', 'VALIDATE_SUBMISSION_FAIL', { reason: 'PROMPT_STILL_IN_INPUT_NO_STOP' });
    console.warn('[ChatGPTAdapter] Validation failed: Prompt still in input and no stop button');
    return false;
  }

  /**
   * 启动流式生成监听
   */
  public listenGeneration(
    onUpdate: (snapshot: string, cleaned: string) => void,
    onDone: (finalCleaned: string) => void
  ): () => void {
    const chatContainer =
      document.querySelector<HTMLElement>('main, div[class*="react-scroll-to-bottom"], div[role="presentation"]') ||
      document.body;

    this.activeDetector = new QuadSignalDoneDetector({
      getStopButton: () => this.findStopButton(),
      getSendButton: () => this.findSendButton(),
      getCurrentContent: () => {
        const lastMsgEl = this.findLatestAssistantMessageElement();
        if (!lastMsgEl) return '';

        if (lastMsgEl === this.baselineLastElement) {
          const currentText = (lastMsgEl.innerText || lastMsgEl.textContent || '').trim();
          if (currentText === this.baselineLastContent) {
            return '';
          }
        }

        const md = domToMarkdown(lastMsgEl);
        const result = (md && md.trim().length > 0) ? md : (lastMsgEl.innerText || lastMsgEl.textContent || '').trim();
        this.currentSnapshot = result;
        return result;
      },
      onUpdate: (rawMd) => {
        const { cleaned } = stripThinkBlocks(rawMd);
        onUpdate(rawMd, cleaned);
      },
      onDone: (finalRawMd) => {
        const { cleaned } = stripThinkBlocks(finalRawMd);
        onDone(cleaned);
      },
      silenceThresholdMs: 12000,
    });

    this.activeDetector.start(chatContainer);

    return () => {
      if (this.activeDetector) {
        this.activeDetector.destroy();
        this.activeDetector = null;
      }
    };
  }

  // --- 内部 DOM 元素查找工具 ---

  public dismissDialogs(): boolean {
    // 自动检测并关闭诸如 "Your account was switched"、"Stay logged out"、"Something went wrong" 等异常弹窗
    const dialogButtons = Array.from(
      document.querySelectorAll<HTMLElement>(
        'div[role="dialog"] button, div[role="alertdialog"] button, div[class*="modal"] button, div[data-state="open"] button'
      )
    );
    let dismissed = false;
    for (const btn of dialogButtons) {
      const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
      if (
        text.includes('stay logged out') ||
        text.includes('dismiss') ||
        text.includes('ok') ||
        text.includes('reload') ||
        text.includes('try again') ||
        text.includes('确定') ||
        text.includes('知道了') ||
        text.includes('重试') ||
        text.includes('关闭') ||
        btn.getAttribute('aria-label') === 'Close'
      ) {
        btn.click();
        dismissed = true;
      }
    }
    return dismissed;
  }

  /**
   * 智能自愈与状态恢复
   */
  public async autoRecoverAndContinue(
    prompt: string,
    onUpdate: (snapshot: string, cleaned: string) => void,
    onDone: (finalCleaned: string) => void
  ): Promise<'DONE' | 'STREAMING' | 'SENT' | 'FAILED'> {
    // 步骤 1：关闭账户切换或报错遮罩弹窗
    this.dismissDialogs();
    await this.sleep(300);

    // 步骤 2：检查是否已经产出了回答
    const lastMsg = this.findLatestAssistantMessageElement();
    const currentText = lastMsg ? (lastMsg.innerText || lastMsg.textContent || '').trim() : '';
    if (lastMsg && lastMsg !== this.baselineLastElement && currentText.length > 15 && !this.findStopButton()) {
      const md = domToMarkdown(lastMsg);
      const cleaned = (md && md.trim().length > 0) ? md : currentText;
      onDone(cleaned);
      return 'DONE';
    }

    // 步骤 3：检查是否正在流式生成中
    if (this.findStopButton()) {
      this.listenGeneration(onUpdate, onDone);
      return 'STREAMING';
    }

    // 步骤 4：检查输入框是否已经含有提示词内容
    const input = this.findInputElement();
    if (input) {
      const inputVal = input instanceof HTMLTextAreaElement ? input.value : (input.textContent || '');
      if (inputVal.trim().length > 0) {
        const sendBtn = this.findSendButton();
        if (sendBtn && !sendBtn.hasAttribute('disabled')) {
          sendBtn.click();
        } else {
          const eventInit: KeyboardEventInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
          input.focus();
          input.dispatchEvent(new KeyboardEvent('keydown', eventInit));
          input.dispatchEvent(new KeyboardEvent('keyup', eventInit));
        }
        await this.sleep(400);
        this.listenGeneration(onUpdate, onDone);
        return 'STREAMING';
      }
    }

    // 步骤 5：输入框为空，重新执行完整注入与提交
    const sent = await this.sendPrompt(prompt);
    if (sent) {
      this.listenGeneration(onUpdate, onDone);
      return 'STREAMING';
    }

    return 'FAILED';
  }

  public findInputElement(): HTMLElement | null {
    // 1. 优先匹配正式的聊天输入框 #prompt-textarea
    const promptTextarea = document.querySelector<HTMLElement>(
      '#prompt-textarea, div[contenteditable="true"]#prompt-textarea, textarea#prompt-textarea'
    );
    if (promptTextarea) return promptTextarea;

    // 2. 匹配通用 contenteditable 富文本输入框 (ProseMirror)
    const contentEditable = document.querySelector<HTMLElement>(
      'div[contenteditable="true"][data-placeholder], div[contenteditable="true"].ProseMirror, div[contenteditable="true"]'
    );
    if (contentEditable) return contentEditable;

    // 3. 匹配非 pending 占位符的有效 textarea（严禁将 SSR 阶段的 #pending-home-input 当作已就绪输入框）
    const nonPendingTextareas = Array.from(
      document.querySelectorAll<HTMLTextAreaElement>('textarea:not([aria-hidden="true"])')
    ).filter(
      (el) => el.id !== 'pending-home-input' && el.getAttribute('data-id') !== 'root'
    );
    if (nonPendingTextareas.length > 0 && nonPendingTextareas[0]) {
      return nonPendingTextareas[0];
    }

    return null;
  }

  private findSendButton(): HTMLElement | null {
    const direct = (
      document.querySelector<HTMLElement>('button[data-testid="send-button"]') ||
      document.querySelector<HTMLElement>('button[data-testid="fruitjuice-send-button"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="Send prompt"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="Send message"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="发送提示词"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="发送消息"]') ||
      document.querySelector<HTMLElement>('button[aria-label="发送"]')
    );
    if (direct) return direct;

    // 向上从输入框的父级表单中寻找操作按钮
    const input = this.findInputElement();
    const form = input?.closest('form');
    if (form) {
      const candidates = Array.from(form.querySelectorAll<HTMLElement>('button'));
      const sendCandidate = candidates.reverse().find((b) => {
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const testid = (b.getAttribute('data-testid') || '').toLowerCase();
        if (
          aria.includes('attach') ||
          aria.includes('voice') ||
          aria.includes('upload') ||
          aria.includes('mic') ||
          testid.includes('voice') ||
          testid.includes('speech')
        ) {
          return false;
        }
        return b.querySelector('svg') !== null;
      });
      if (sendCandidate) return sendCandidate;
    }

    return null;
  }

  private findStopButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('button[data-testid="stop-button"]') ||
      document.querySelector<HTMLElement>('button[aria-label="Stop streaming"]') ||
      document.querySelector<HTMLElement>('button[aria-label="Stop generating"]') ||
      document.querySelector<HTMLElement>('button[aria-label="停止生成"]') ||
      document.querySelector<HTMLElement>('button[aria-label="停止响应"]')
    );
  }

  private findLatestAssistantMessageElement(): HTMLElement | null {
    // 1. 查找所有包含 assistant 标记的明确容器
    const assistantRoles = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-message-author-role="assistant"], [data-message-model-slug], div[class*="agent-turn"]'
      )
    );
    if (assistantRoles.length > 0) {
      const last = assistantRoles[assistantRoles.length - 1]!;
      const md = last.querySelector<HTMLElement>(
        '.markdown, [class*="markdown"], .prose, [class*="prose"], div[class*="text-message"], div.whitespace-pre-wrap'
      ) || last;
      if ((md.textContent || '').trim().length > 0) {
        return md;
      }
    }

    // 2. 现代 ChatGPT 核心架构：所有聊天轮次均为 article 标签
    // 严格通过用户编辑按钮 (Edit / 编辑) 或 user 角色排除用户提问卡片
    const isUserArticle = (art: HTMLElement): boolean => {
      if (art.getAttribute('data-message-author-role') === 'user') return true;
      if (art.querySelector('[data-message-author-role="user"]')) return true;
      if (art.querySelector('button[aria-label*="Edit"], button[aria-label*="编辑"]')) return true;
      return false;
    };

    const articles = Array.from(document.querySelectorAll<HTMLElement>('article'));
    if (articles.length > 0) {
      const nonUserArticles = articles.filter((art) => !isUserArticle(art));
      if (nonUserArticles.length > 0) {
        const lastArt = nonUserArticles[nonUserArticles.length - 1]!;
        const md = lastArt.querySelector<HTMLElement>(
          '.markdown, [class*="markdown"], .prose, [class*="prose"], div[class*="text-message"], div.whitespace-pre-wrap'
        ) || lastArt;
        if ((md.textContent || '').trim().length > 0) {
          return md;
        }
      }
    }

    // 3. 特征锚点定位：通过助手专属操作按钮（复制回答、点赞/点踩、朗读）反向溯源所属卡片
    const assistantButtons = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button[aria-label*="Copy"], button[aria-label*="复制"], button[aria-label*="Good response"], button[aria-label*="赞"], [data-testid*="copy"]'
      )
    );
    for (let i = assistantButtons.length - 1; i >= 0; i--) {
      const btn = assistantButtons[i]!;
      const turnContainer = btn.closest<HTMLElement>(
        'article, div[class*="agent-turn"], div[data-message-id], div[class*="conversation-turn"]'
      );
      if (turnContainer && !isUserArticle(turnContainer)) {
        const md = turnContainer.querySelector<HTMLElement>(
          '.markdown, [class*="markdown"], .prose, [class*="prose"], div[class*="text-message"], div.whitespace-pre-wrap'
        ) || turnContainer;
        if ((md.textContent || '').trim().length > 0) {
          return md;
        }
      }
    }

    // 4. 降级：查询页面中所有的 markdown / prose / 富文本容器
    const mdElements = Array.from(
      document.querySelectorAll<HTMLElement>(
        'div[class*="markdown"], div[class*="prose"], .markdown, .prose, div[class*="text-message"]'
      )
    ).filter((el) => {
      const art = el.closest('article');
      if (art && isUserArticle(art)) return false;
      return true;
    });

    if (mdElements.length > 0) {
      const lastMd = mdElements[mdElements.length - 1]!;
      if ((lastMd.textContent || '').trim().length > 0) {
        return lastMd;
      }
    }

    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

export const chatGPTAdapter = new ChatGPTAdapter();
adapterRegistry.register(chatGPTAdapter);
