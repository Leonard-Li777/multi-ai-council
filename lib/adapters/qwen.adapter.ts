import type { AISiteAdapter } from './base';
import { adapterRegistry } from './base';
import type { SupportedSite } from '../types/review-job';
import { simulateTextInput } from '../utils/insert-text';
import { stripThinkBlocks } from '../utils/think-block-strip';
import { domToMarkdown } from '../utils/dom-to-markdown';
import { QuadSignalDoneDetector } from '../utils/done-detector';

export class QwenAdapter implements AISiteAdapter {
  public readonly siteName: SupportedSite = 'Qwen';
  public readonly urlPattern = /^https:\/\/chat\.qwen\.ai(\/.*)?$/;
  public readonly adapterVersion = '1.0.0';

  private activeDetector: QuadSignalDoneDetector | null = null;
  private currentSnapshot = '';

  public async isReady(): Promise<boolean> {
    const input = this.findInputElement();
    return input !== null;
  }

  public async checkBlocker(): Promise<'OK' | 'CAPTCHA' | 'RATE_LIMIT' | 'NOT_LOGGED_IN' | 'DOM_CHANGED'> {
    // 1. 人机验证
    const captcha = document.querySelector(
      'iframe[src*="captcha"], #baxia-dialog-content, div[class*="nc-container"], div[class*="captcha"]'
    );
    if (captcha) return 'CAPTCHA';

    // 2. 未登录检查
    const loginBtn = document.querySelector(
      'a[href*="/login"], button:has-text("登录"), button:has-text("Sign in"), div[class*="login-button"]'
    );
    if (loginBtn) return 'NOT_LOGGED_IN';

    // 3. 限流检查
    const errorBanner = document.querySelector('div[class*="error-tip"], div[class*="rate-limit"]');
    if (errorBanner) return 'RATE_LIMIT';

    // 4. 输入框是否存在
    const input = this.findInputElement();
    if (!input) return 'DOM_CHANGED';

    return 'OK';
  }

  public async createNewChat(): Promise<void> {
    const newChatBtn = document.querySelector<HTMLElement>(
      'button[class*="new-chat"], a[href="/"], div[class*="new-chat-btn"], button[aria-label*="新会话"]'
    );
    if (newChatBtn && window.location.pathname !== '/') {
      newChatBtn.click();
      await this.sleep(1000);
    } else if (window.location.pathname !== '/') {
      window.location.href = 'https://chat.qwen.ai/';
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
      document.querySelector<HTMLElement>('main, div[class*="chat-container"], div[class*="message-list"]') ||
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
      document.querySelector<HTMLElement>('#chat-input') ||
      document.querySelector<HTMLElement>('textarea[placeholder*="问"]') ||
      document.querySelector<HTMLElement>('textarea[placeholder*="Qwen"]') ||
      document.querySelector<HTMLElement>('textarea') ||
      document.querySelector<HTMLElement>('div[contenteditable="true"]')
    );
  }

  private findSendButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('button[class*="send-button"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="发送"]') ||
      document.querySelector<HTMLElement>('div[role="button"][class*="send"]') ||
      document.querySelector<HTMLElement>('button:has(svg)')
    );
  }

  private findStopButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('button[aria-label*="停止"]') ||
      document.querySelector<HTMLElement>('button[class*="stop"]') ||
      document.querySelector<HTMLElement>('div[class*="stop-btn"]')
    );
  }

  private findLatestAssistantMessageElement(): HTMLElement | null {
    const msgs = Array.from(
      document.querySelectorAll<HTMLElement>(
        'div[class*="assistant-message"], div[class*="message-assistant"], div.qwen-markdown, div[class*="markdown"]'
      )
    );
    if (msgs.length === 0) return null;
    return msgs[msgs.length - 1] ?? null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

export const qwenAdapter = new QwenAdapter();
adapterRegistry.register(qwenAdapter);
