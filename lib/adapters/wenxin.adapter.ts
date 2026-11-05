import type { AISiteAdapter } from './base';
import { adapterRegistry } from './base';
import type { SupportedSite } from '../types/review-job';
import { simulateTextInput } from '../utils/insert-text';
import { stripThinkBlocks } from '../utils/think-block-strip';
import { domToMarkdown } from '../utils/dom-to-markdown';
import { QuadSignalDoneDetector } from '../utils/done-detector';
import { hasElementWithText } from '../utils/dom-checker';

export class WenxinAdapter implements AISiteAdapter {
  public readonly siteName: SupportedSite = 'Wenxin';
  public readonly urlPattern = /^https:\/\/wenxin\.baidu\.com(\/.*)?$/;
  public readonly adapterVersion = '1.0.0';

  private activeDetector: QuadSignalDoneDetector | null = null;
  private currentSnapshot = '';

  public async isReady(): Promise<boolean> {
    const input = this.findInputElement();
    return input !== null;
  }

  public async checkBlocker(): Promise<'OK' | 'CAPTCHA' | 'RATE_LIMIT' | 'NOT_LOGGED_IN' | 'DOM_CHANGED'> {
    // 1. 人机验证
    const captcha = document.querySelector('div[class*="vcode"], div[class*="captcha"], #pass-dialog');
    if (captcha) return 'CAPTCHA';

    // 2. 百度登录弹窗或未登录
    const loginModal = document.querySelector(
      '#passport-login-pop, div[class*="login-dialog"], a[href*="passport.baidu.com"]'
    );
    if (loginModal || hasElementWithText('button, a, span, div[class*="login"]', ['登录'])) return 'NOT_LOGGED_IN';

    // 3. 限流
    const limit = document.querySelector('div[class*="limit-tip"], div[class*="warn-text"]');
    if (limit) return 'RATE_LIMIT';

    // 4. 输入框检查
    const input = this.findInputElement();
    if (!input) return 'DOM_CHANGED';

    return 'OK';
  }

  public async createNewChat(): Promise<void> {
    const newChatBtn = document.querySelector<HTMLElement>(
      'div[class*="new-chat"], button[class*="new-chat"], span[class*="newChat"]'
    );
    if (newChatBtn && window.location.pathname !== '/') {
      newChatBtn.click();
      await this.sleep(1000);
    } else if (window.location.pathname !== '/') {
      window.location.href = 'https://wenxin.baidu.com/';
    }
  }

  public getConversationUrl(): string {
    return window.location.href;
  }

  public async sendPrompt(prompt: string): Promise<boolean> {
    const input = this.findInputElement();
    if (!input) return false;

    const injected = await simulateTextInput(input, prompt);
    if (!injected) return false;

    await this.sleep(400);

    const sendBtn = this.findSendButton();
    const isAriaDisabled = sendBtn?.getAttribute('aria-disabled') === 'true';
    const isDisabled = sendBtn?.hasAttribute('disabled') || isAriaDisabled;
    if (sendBtn && !isDisabled) {
      sendBtn.click();
      return true;
    }

    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
      })
    );
    return true;
  }

  public async validateSubmission(): Promise<boolean> {
    for (let i = 0; i < 5; i++) {
      await this.sleep(500);
      const stopBtn = this.findStopButton();
      if (stopBtn) return true;

      const input = this.findInputElement();
      if (input) {
        const val = input instanceof HTMLTextAreaElement ? input.value : input.innerText;
        if (val.trim().length === 0) return true;
      }
    }
    return true;
  }

  public listenGeneration(
    onUpdate: (snapshot: string, cleaned: string) => void,
    onDone: (finalCleaned: string) => void
  ): () => void {
    const chatContainer =
      document.querySelector<HTMLElement>('main, div[class*="chat-wrap"], div[class*="dialogue"]') ||
      document.body;

    this.activeDetector = new QuadSignalDoneDetector({
      getStopButton: () => this.findStopButton(),
      getSendButton: () => this.findSendButton(),
      getCurrentContent: () => {
        const lastMsgEl = this.findLatestAssistantMessageElement();
        if (!lastMsgEl) return '';
        const md = domToMarkdown(lastMsgEl);
        this.currentSnapshot = md;
        return md;
      },
      onUpdate: (rawMd) => {
        const { cleaned } = stripThinkBlocks(rawMd);
        onUpdate(rawMd, cleaned);
      },
      onDone: (finalRawMd) => {
        const { cleaned } = stripThinkBlocks(finalRawMd);
        onDone(cleaned);
      },
      silenceThresholdMs: 2000,
    });

    this.activeDetector.start(chatContainer);

    return () => {
      if (this.activeDetector) {
        this.activeDetector.destroy();
        this.activeDetector = null;
      }
    };
  }

  private findInputElement(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('div[contenteditable="true"]') ||
      document.querySelector<HTMLElement>('textarea[class*="input"]') ||
      document.querySelector<HTMLElement>('#contenteditable') ||
      document.querySelector<HTMLElement>('textarea') ||
      document.querySelector<HTMLElement>('div.chat-input')
    );
  }

  private findSendButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('button[class*="send"]') ||
      document.querySelector<HTMLElement>('span[class*="send-btn"]') ||
      document.querySelector<HTMLElement>('div[class*="send-btn"]') ||
      document.querySelector<HTMLElement>('div[role="button"][aria-label*="发送"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="发送"]') ||
      document.querySelector<HTMLElement>('button:has(svg)')
    );
  }

  private findStopButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('span[class*="stop"]') ||
      document.querySelector<HTMLElement>('button[class*="stop"]') ||
      document.querySelector<HTMLElement>('div[class*="stop-btn"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="停止"]')
    );
  }

  private findLatestAssistantMessageElement(): HTMLElement | null {
    const msgs = Array.from(
      document.querySelectorAll<HTMLElement>(
        'div[class*="assistant"], div[class*="bot-message"], div[class*="markdown-body"], div.markdown'
      )
    );
    if (msgs.length === 0) return null;
    return msgs[msgs.length - 1] ?? null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

export const wenxinAdapter = new WenxinAdapter();
adapterRegistry.register(wenxinAdapter);
