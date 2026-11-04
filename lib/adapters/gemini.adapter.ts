import type { AISiteAdapter } from './base';
import { adapterRegistry } from './base';
import type { SupportedSite } from '../types/review-job';
import { simulateTextInput } from '../utils/insert-text';
import { stripThinkBlocks } from '../utils/think-block-strip';
import { domToMarkdown } from '../utils/dom-to-markdown';
import { QuadSignalDoneDetector } from '../utils/done-detector';

export class GeminiAdapter implements AISiteAdapter {
  public readonly siteName: SupportedSite = 'Gemini';
  public readonly urlPattern = /^https:\/\/gemini\.google\.com(\/.*)?$/;
  public readonly adapterVersion = '1.0.0';

  private activeDetector: QuadSignalDoneDetector | null = null;
  private currentSnapshot = '';

  public async isReady(): Promise<boolean> {
    const input = this.findInputElement();
    return input !== null;
  }

  public async checkBlocker(): Promise<'OK' | 'CAPTCHA' | 'RATE_LIMIT' | 'NOT_LOGGED_IN' | 'DOM_CHANGED'> {
    // 1. Google 登录态检查
    const signInBtn = document.querySelector(
      'a[href*="accounts.google.com"], button:has-text("Sign in"), button:has-text("登录")'
    );
    if (signInBtn) return 'NOT_LOGGED_IN';

    // 2. 限流 / 配额超限
    const limitBanner = document.querySelector('div[class*="error-message"], div[class*="rate-limit"]');
    if (limitBanner) return 'RATE_LIMIT';

    // 3. 输入框是否存在
    const input = this.findInputElement();
    if (!input) return 'DOM_CHANGED';

    return 'OK';
  }

  public async createNewChat(): Promise<void> {
    const newChatBtn = document.querySelector<HTMLElement>(
      'a[href="/app"], button[aria-label*="New chat"], button[aria-label*="新对话"], [data-test-id="new-chat-button"]'
    );
    if (newChatBtn && window.location.pathname !== '/app') {
      newChatBtn.click();
      await this.sleep(1000);
    } else if (window.location.pathname !== '/app') {
      window.location.href = 'https://gemini.google.com/app';
    }
  }

  public getConversationUrl(): string {
    return window.location.href;
  }

  public async sendPrompt(prompt: string): Promise<boolean> {
    const input = this.findInputElement();
    if (!input) return false;

    // Gemini 使用 Quill 富文本编辑器 (div.ql-editor)
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
      document.querySelector<HTMLElement>('main, div[class*="chat-history"], div[class*="conversation-container"]') ||
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
      document.querySelector<HTMLElement>('div[contenteditable="true"].ql-editor') ||
      document.querySelector<HTMLElement>('div.ql-editor') ||
      document.querySelector<HTMLElement>('rich-textarea div[contenteditable="true"]') ||
      document.querySelector<HTMLElement>('div[contenteditable="true"]') ||
      document.querySelector<HTMLElement>('textarea')
    );
  }

  private findSendButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('button[aria-label*="Send message"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="发送消息"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="Send"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="发送"]') ||
      document.querySelector<HTMLElement>('button.send-button') ||
      document.querySelector<HTMLElement>('button[data-test-id="send-button"]') ||
      document.querySelector<HTMLElement>('button:has(svg)')
    );
  }

  private findStopButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('button[aria-label*="Stop"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="停止"]') ||
      document.querySelector<HTMLElement>('button[data-test-id="stop-button"]')
    );
  }

  private findLatestAssistantMessageElement(): HTMLElement | null {
    const msgs = Array.from(
      document.querySelectorAll<HTMLElement>(
        'model-response, div[class*="response-container"], message-content, div[class*="model-response-text"], div.markdown'
      )
    );
    if (msgs.length === 0) return null;
    return msgs[msgs.length - 1] ?? null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

export const geminiAdapter = new GeminiAdapter();
adapterRegistry.register(geminiAdapter);
