import type { AISiteAdapter } from './base';
import { adapterRegistry } from './base';
import type { SupportedSite } from '../types/review-job';
import { simulateTextInput } from '../utils/insert-text';
import { stripThinkBlocks } from '../utils/think-block-strip';
import { domToMarkdown } from '../utils/dom-to-markdown';
import { QuadSignalDoneDetector } from '../utils/done-detector';
import { isLoginButtonPresent } from '../utils/dom-checker';

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
  public async createNewChat(): Promise<void> {
    // 若当前已经是根路径，本身即为全新会话，无需触发导航
    if (window.location.pathname === '/' || window.location.pathname === '') {
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

    // 1. 轮询等待输入框真正挂载并就绪 (最多等待 8 秒)
    let input: HTMLElement | null = null;
    for (let i = 0; i < 40; i++) {
      input = this.findInputElement();
      if (input && input.isConnected) break;
      await this.sleep(200);
    }

    if (!input) {
      console.error('[ChatGPTAdapter] Input element not found after polling');
      return false;
    }

    // 2. 模拟写入 ProseMirror 富文本 (支持直接更新 ProseMirror 内部 <p> 标签并派发全套事件)
    input.focus();
    let injected = false;
    try {
      injected = await simulateTextInput(input, prompt);
    } catch {}

    // 若富文本模拟写入未生效或为空，执行 ProseMirror DOM 树强力注入保底
    const currentText = input.textContent || '';
    if (!injected || currentText.trim().length === 0) {
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
      injected = true;
    }

    await this.sleep(300);

    // 3. 轮询等待 React/ProseMirror 渲染并解禁发送按钮 (最多 3 秒)
    let clicked = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      await this.sleep(200);

      // 若已经出现真正的停止按钮，说明已成功进入生成
      if (this.findStopButton()) {
        clicked = true;
        break;
      }

      const sendBtn = this.findSendButton();
      if (sendBtn) {
        const isAriaDisabled = sendBtn.getAttribute('aria-disabled') === 'true';
        const isDisabled = sendBtn.hasAttribute('disabled') || isAriaDisabled;
        if (!isDisabled) {
          sendBtn.click();
          clicked = true;
          await this.sleep(300);
          break;
        } else if (attempt >= 3) {
          // 若 600ms 后依然 aria-disabled，强行解除限制并触发点击
          sendBtn.removeAttribute('disabled');
          sendBtn.setAttribute('aria-disabled', 'false');
          sendBtn.click();
          clicked = true;
          await this.sleep(300);
          break;
        }
      }
    }

    // 4. 强力按键保底：派发真正的 Enter 键盘事件（ProseMirror 最可靠提交方式）
    if (!this.findStopButton()) {
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
      await this.sleep(300);
    }

    return true;
  }

  /**
   * 验证消息是否提交成功
   */
  public async validateSubmission(): Promise<boolean> {
    for (let i = 0; i < 8; i++) {
      await this.sleep(400);
      const stopBtn = this.findStopButton();
      if (stopBtn) return true;

      const input = this.findInputElement();
      if (input) {
        const val = input instanceof HTMLTextAreaElement ? input.value : (input.innerText || input.textContent || '');
        if (val.trim().length === 0) return true;

        // 若输入框仍有文本，再次主动补点一次发送按钮与 Enter
        const sendBtn = this.findSendButton();
        if (sendBtn) {
          sendBtn.removeAttribute('disabled');
          sendBtn.setAttribute('aria-disabled', 'false');
          sendBtn.click();
        }
        input.focus();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      }
    }

    // 最终检查：若依然有 stop 按钮则判定成功
    if (this.findStopButton()) return true;

    // 若输入框已被清空也判定成功
    const finalInput = this.findInputElement();
    if (finalInput) {
      const val = finalInput instanceof HTMLTextAreaElement ? finalInput.value : (finalInput.innerText || finalInput.textContent || '');
      if (val.trim().length === 0) return true;
    }

    // 严格门禁：未清空输入框且无停止按钮，明确返回 false 杜绝谎报成功
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
      silenceThresholdMs: 5000,
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

  private findInputElement(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('#prompt-textarea') ||
      document.querySelector<HTMLElement>('div[contenteditable="true"]#prompt-textarea') ||
      document.querySelector<HTMLElement>('div[contenteditable="true"][data-placeholder]') ||
      document.querySelector<HTMLElement>('textarea[data-id="root"]') ||
      document.querySelector<HTMLElement>('div[contenteditable="true"]') ||
      document.querySelector<HTMLElement>('textarea')
    );
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
    // 1. 查找所有 assistant 消息容器（精准匹配 role="assistant"）
    const assistantRoles = Array.from(
      document.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"]')
    );
    if (assistantRoles.length > 0) {
      const last = assistantRoles[assistantRoles.length - 1]!;
      const md = last.querySelector<HTMLElement>('.markdown, .prose, div[class*="markdown"]') || last;
      if ((md.textContent || '').trim().length > 0) {
        return md;
      }
    }

    // 2. 查找包含 assistant 的 conversation-turn article，排除包含 user 角色的卡片
    const articles = Array.from(
      document.querySelectorAll<HTMLElement>('article[data-testid*="conversation-turn"]')
    );
    if (articles.length > 0) {
      const nonUserArticles = articles.filter(
        (art) => !art.querySelector('[data-message-author-role="user"]')
      );
      if (nonUserArticles.length > 0) {
        const lastArt = nonUserArticles[nonUserArticles.length - 1]!;
        const md = lastArt.querySelector<HTMLElement>('.markdown, .prose, div[class*="markdown"]') || lastArt;
        if ((md.textContent || '').trim().length > 0) {
          return md;
        }
      }
    }

    // 3. 降级：查询页面中所有的 .markdown 或 .prose 容器（ChatGPT 仅在 Assistant 回复中使用 .markdown）
    const mdElements = Array.from(document.querySelectorAll<HTMLElement>('.markdown, .prose'));
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
