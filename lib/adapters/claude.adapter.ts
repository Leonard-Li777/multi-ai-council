import type { AISiteAdapter } from './base';
import { adapterRegistry } from './base';
import type { SupportedSite } from '../types/review-job';
import { simulateTextInput } from '../utils/insert-text';
import { stripThinkBlocks } from '../utils/think-block-strip';
import { domToMarkdown } from '../utils/dom-to-markdown';
import { QuadSignalDoneDetector } from '../utils/done-detector';
import { isLoginButtonPresent } from '../utils/dom-checker';

export class ClaudeAdapter implements AISiteAdapter {
  public readonly siteName: SupportedSite = 'Claude';
  public readonly urlPattern = /^https:\/\/claude\.ai(\/.*)?$/;
  public readonly adapterVersion = '1.0.0';

  private activeDetector: QuadSignalDoneDetector | null = null;
  private currentSnapshot = '';
  private baselineLastElement: HTMLElement | null = null;
  private baselineLastContent = '';
  private lastPrompt = '';

  public recordBaseline(): void {
    const el = this.findLatestAssistantMessageElement();
    this.baselineLastElement = el;
    this.baselineLastContent = el ? (domToMarkdown(el) || el.innerText || el.textContent || '').trim() : '';
  }

  /**
   * 检查页面是否就绪（Claude ProseMirror 富文本输入框已呈现）
   */
  public async isReady(): Promise<boolean> {
    const input = this.findInputElement();
    return input !== null;
  }

  /**
   * 检查页面阻断状态（Cloudflare Turnstile、未登录、使用配额耗尽等）
   */
  public async checkBlocker(): Promise<'OK' | 'CAPTCHA' | 'RATE_LIMIT' | 'NOT_LOGGED_IN' | 'DOM_CHANGED'> {
    // 1. 若输入框已存在，绝非未登录
    const input = this.findInputElement();
    if (input) {
      const captcha = document.querySelector(
        'iframe[src*="challenges.cloudflare.com"], #challenge-running, div[class*="turnstile"], div[id*="cf-challenge"]'
      );
      if (captcha) return 'CAPTCHA';
      return 'OK';
    }

    // 2. Cloudflare 质询
    const captcha = document.querySelector(
      'iframe[src*="challenges.cloudflare.com"], #challenge-running, div[class*="turnstile"], div[id*="cf-challenge"]'
    );
    if (captcha) return 'CAPTCHA';

    // 3. 未登录检查（如重定向至 /login）
    if (
      window.location.pathname.startsWith('/login') ||
      window.location.pathname.startsWith('/signup') ||
      isLoginButtonPresent()
    ) {
      return 'NOT_LOGGED_IN';
    }

    // 4. 限流 / 使用额度上限检查
    const limitBanner = document.querySelector(
      'div[class*="border-danger"], div[class*="text-danger"], div[role="alert"]'
    );
    if (limitBanner) {
      const text = limitBanner.textContent?.toLowerCase() || '';
      if (text.includes('usage limit') || text.includes('free plan limit') || text.includes('rate limit')) {
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
      'div[data-is-streaming], div[class*="font-claude-message"], div[class*="standard-markdown"]'
    );
    return msgs.length > 0;
  }

  /**
   * 开启新会话
   */
  public async createNewChat(): Promise<void> {
    const newChatBtn = document.querySelector<HTMLElement>(
      'a[href="/new"], a[data-testid="new-chat-button"], button[aria-label*="New chat"], button[aria-label*="新会话"]'
    );

    if (newChatBtn) {
      newChatBtn.click();
      await this.sleep(500);
    }
  }

  /**
   * 获取当前会话远程 URL
   */
  public getConversationUrl(): string {
    return window.location.href;
  }

  /**
   * 注入提示词并点击发送（攻坚 ProseMirror contenteditable 与状态同步）
   */
  public async sendPrompt(prompt: string): Promise<boolean> {
    this.recordBaseline();
    this.lastPrompt = prompt;

    const input = this.findInputElement();
    if (!input) {
      console.error('[ClaudeAdapter] Input element not found');
      return false;
    }

    // 1. 模拟写入 ProseMirror 富文本
    const injected = await simulateTextInput(input, prompt);
    if (!injected) {
      console.error('[ClaudeAdapter] Failed to inject prompt text into Claude');
      return false;
    }

    await this.sleep(400);

    // 2. 寻找发送按钮并触发点击
    const sendBtn = this.findSendButton();
    const isAriaDisabled = sendBtn?.getAttribute('aria-disabled') === 'true';
    const isDisabled = sendBtn?.hasAttribute('disabled') || isAriaDisabled;
    if (sendBtn && !isDisabled) {
      sendBtn.click();
      await this.sleep(200);
    }

    // 3. 检查输入框是否已被清空，若未清空则补发完整的 Enter 键盘事件
    const currentVal = input instanceof HTMLTextAreaElement ? input.value : (input.textContent || '');
    if (currentVal.trim().length > 0) {
      const eventInit: KeyboardEventInit = {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true,
      };
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', eventInit));
      input.dispatchEvent(new KeyboardEvent('keypress', eventInit));
      input.dispatchEvent(new KeyboardEvent('keyup', eventInit));
    }
    return true;
  }

  /**
   * 验证消息是否提交成功
   */
  public async validateSubmission(): Promise<boolean> {
    for (let i = 0; i < 5; i++) {
      await this.sleep(400);
      const stopBtn = this.findStopButton();
      if (stopBtn) return true;

      const input = this.findInputElement();
      if (input) {
        const val = input instanceof HTMLTextAreaElement ? input.value : input.innerText;
        if (val.trim().length === 0) return true;
      }
    }
    const input = this.findInputElement();
    if (input) {
      input.focus();
      const eventInit: KeyboardEventInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
      input.dispatchEvent(new KeyboardEvent('keydown', eventInit));
      input.dispatchEvent(new KeyboardEvent('keypress', eventInit));
      input.dispatchEvent(new KeyboardEvent('keyup', eventInit));
      await this.sleep(200);
    }
    return true;
  }

  /**
   * 启动流式生成监听
   */
  public listenGeneration(
    onUpdate: (snapshot: string, cleaned: string) => void,
    onDone: (finalCleaned: string) => void
  ): () => void {
    const chatContainer =
      document.querySelector<HTMLElement>('main, div[class*="chat-history"], div[class*="standard-markdown"]') ||
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

        // DOM 克隆净化：彻底剔除进度指示器、运行状态面板、思考临时条与各类操作按钮
        const clone = lastMsgEl.cloneNode(true) as HTMLElement;
        clone
          .querySelectorAll(
            'button, [role="toolbar"], div[class*="toolbar"], div[class*="footer"], div[class*="header"], [class*="progress"], [class*="status"], [class*="running"], [data-testid*="artifact"], div[class*="thinking"]'
          )
          .forEach((el) => {
            el.remove();
          });

        // 深度递归清除包含“运行中”、“已运行”等瞬时进度特征的浮动卡片节点
        const allNodes = Array.from(clone.querySelectorAll<HTMLElement>('div, span, p'));
        for (const node of allNodes) {
          const text = (node.innerText || node.textContent || '').trim();
          if (
            (text.includes('运行中') || text.includes('已运行') || /^\d+分钟\s*\d*秒?运行中/.test(text)) &&
            node.children.length === 0
          ) {
            node.remove();
          }
        }

        const md = domToMarkdown(clone);
        const result = (md && md.trim().length > 0) ? md : (clone.innerText || clone.textContent || '').trim();

        // 核心防角色污染门禁：严禁将用户输入的 Prompt 误采为助手回答
        if (this.lastPrompt.trim().length > 30) {
          const lead = this.lastPrompt.trim().slice(0, 60);
          if (result.trim().startsWith(lead)) {
            return '';
          }
        }

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
      userPrompt: this.lastPrompt,
    });

    this.activeDetector.start(chatContainer);

    return () => {
      if (this.activeDetector) {
        this.activeDetector.destroy();
        this.activeDetector = null;
      }
    };
  }

  public dismissDialogs(): boolean {
    const dialogButtons = Array.from(
      document.querySelectorAll<HTMLElement>('div[role="dialog"] button, div[class*="modal"] button')
    );
    let dismissed = false;
    for (const btn of dialogButtons) {
      const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
      if (text.includes('dismiss') || text.includes('close') || text.includes('ok') || text.includes('确定') || text.includes('知道了')) {
        btn.click();
        dismissed = true;
      }
    }
    return dismissed;
  }

  public async autoRecoverAndContinue(
    prompt: string,
    onUpdate: (snapshot: string, cleaned: string) => void,
    onDone: (finalCleaned: string) => void
  ): Promise<'DONE' | 'STREAMING' | 'SENT' | 'FAILED'> {
    this.dismissDialogs();
    await this.sleep(300);

    const lastMsg = this.findLatestAssistantMessageElement();
    const currentText = lastMsg ? (lastMsg.innerText || lastMsg.textContent || '').trim() : '';
    if (lastMsg && lastMsg !== this.baselineLastElement && currentText.length > 15 && !this.findStopButton()) {
      const md = domToMarkdown(lastMsg);
      const cleaned = (md && md.trim().length > 0) ? md : currentText;
      onDone(cleaned);
      return 'DONE';
    }

    if (this.findStopButton()) {
      this.listenGeneration(onUpdate, onDone);
      return 'STREAMING';
    }

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

    const sent = await this.sendPrompt(prompt);
    if (sent) {
      this.listenGeneration(onUpdate, onDone);
      return 'STREAMING';
    }

    return 'FAILED';
  }

  // --- 内部 DOM 元素查找工具 ---

  private findInputElement(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('div[contenteditable="true"].ProseMirror') ||
      document.querySelector<HTMLElement>('div[data-testid="chat-input"]') ||
      document.querySelector<HTMLElement>('div.ProseMirror[contenteditable="true"]') ||
      document.querySelector<HTMLElement>('div[contenteditable="true"]') ||
      document.querySelector<HTMLElement>('fieldset div[contenteditable="true"]') ||
      document.querySelector<HTMLElement>('textarea')
    );
  }

  private findSendButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('button[aria-label*="Send Message"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="Send message"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="发送消息"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="发送"]') ||
      document.querySelector<HTMLElement>('button[data-testid="send-button"]') ||
      document.querySelector<HTMLElement>('fieldset button:has(svg)')
    );
  }

  private findStopButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('button[aria-label*="Stop Response"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="Stop responding"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="停止响应"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="停止生成"]') ||
      document.querySelector<HTMLElement>('button[data-testid*="stop"]')
    );
  }

  private findLatestAssistantMessageElement(): HTMLElement | null {
    // Claude 助手消息包含 font-claude-message 类或 standard-markdown
    const claudeMessages = Array.from(
      document.querySelectorAll<HTMLElement>(
        'div.font-claude-message, div[class*="font-claude-message"], div[data-is-streaming], div.standard-markdown'
      )
    );
    if (claudeMessages.length === 0) {
      // 降级：查询包含 markdown 类的最后一个大容器
      const mdElements = Array.from(document.querySelectorAll<HTMLElement>('.markdown, .prose'));
      if (mdElements.length === 0) return null;
      return mdElements[mdElements.length - 1] ?? null;
    }

    const lastMsg = claudeMessages[claudeMessages.length - 1];
    return lastMsg ?? null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

export const claudeAdapter = new ClaudeAdapter();
adapterRegistry.register(claudeAdapter);
