import type { AISiteAdapter } from './base';
import type { SupportedSite } from '../types/review-job';
import { simulateTextInput } from '../utils/insert-text';
import { stripThinkBlocks } from '../utils/think-block-strip';
import { domToMarkdown } from '../utils/dom-to-markdown';
import { QuadSignalDoneDetector } from '../utils/done-detector';

export class DeepSeekAdapter implements AISiteAdapter {
  public readonly siteName: SupportedSite = 'DeepSeek';
  public readonly urlPattern = /^https:\/\/chat\.deepseek\.com(\/.*)?$/;
  public readonly adapterVersion = '1.0.0';

  private activeDetector: QuadSignalDoneDetector | null = null;
  private currentSnapshot = '';

  /**
   * 检查页面是否就绪
   */
  public async isReady(): Promise<boolean> {
    const input = this.findInputElement();
    return input !== null;
  }

  /**
   * 检查是否存在阻断（登录、验证码等）
   */
  public async checkBlocker(): Promise<'OK' | 'CAPTCHA' | 'RATE_LIMIT' | 'NOT_LOGGED_IN' | 'DOM_CHANGED'> {
    // 1. 检查是否未登录
    const loginBtn = document.querySelector('a[href*="/login"], button:has-text("登录"), button:has-text("Sign in")');
    if (loginBtn) return 'NOT_LOGGED_IN';

    // 2. 检查人机验证 (Cloudflare Turnstile / Geetest)
    const captcha = document.querySelector('iframe[src*="challenges.cloudflare.com"], #geetest_holder, div[class*="captcha"]');
    if (captcha) return 'CAPTCHA';

    // 3. 检查输入框是否存在
    const input = this.findInputElement();
    if (!input) return 'DOM_CHANGED';

    return 'OK';
  }

  /**
   * 开启新会话
   */
  public async createNewChat(): Promise<void> {
    const newChatBtn = document.querySelector<HTMLElement>(
      'div[role="button"][class*="new"], a[href="/"], div[class*="new-chat"], button:has(svg)'
    );
    if (newChatBtn && window.location.pathname !== '/') {
      newChatBtn.click();
      await this.sleep(1000);
    } else if (window.location.pathname !== '/') {
      window.location.href = 'https://chat.deepseek.com/';
    }
  }

  /**
   * 获取当前会话远程 URL
   */
  public getConversationUrl(): string {
    return window.location.href;
  }

  /**
   * 注入提示词并点击发送
   */
  public async sendPrompt(prompt: string): Promise<boolean> {
    const input = this.findInputElement();
    if (!input) {
      console.error('[DeepSeekAdapter] Input element not found');
      return false;
    }

    // 1. 模拟富文本写入
    const injected = await simulateTextInput(input, prompt);
    if (!injected) {
      console.error('[DeepSeekAdapter] Failed to inject prompt text');
      return false;
    }

    await this.sleep(400);

    // 2. 点击发送按钮或触发 Enter
    const sendBtn = this.findSendButton();
    if (sendBtn && !sendBtn.hasAttribute('disabled')) {
      sendBtn.click();
      return true;
    }

    // 降级：模拟 Enter 键
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

  /**
   * 验证消息是否成功提交
   */
  public async validateSubmission(): Promise<boolean> {
    // 等待 1.5 秒检查输入框是否已被清空，或停止按钮是否出现
    await this.sleep(1500);
    const input = this.findInputElement();
    const stopBtn = this.findStopButton();

    if (stopBtn) return true;
    if (input) {
      const val = input instanceof HTMLTextAreaElement ? input.value : input.innerText;
      return val.trim().length === 0;
    }
    return true;
  }

  /**
   * 监听流式输出
   */
  public listenGeneration(
    onUpdate: (snapshot: string, cleaned: string) => void,
    onDone: (finalCleaned: string) => void
  ): () => void {
    // 找到消息列表容器或主聊天容器
    const chatContainer =
      document.querySelector<HTMLElement>('div[class*="chat-container"], main, div[class*="message-list"]') ||
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

  // --- 内部 DOM 查找工具 ---

  private findInputElement(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('#chat-input') ||
      document.querySelector<HTMLElement>('textarea[placeholder*="发送"]') ||
      document.querySelector<HTMLElement>('textarea[placeholder*="DeepSeek"]') ||
      document.querySelector<HTMLElement>('textarea') ||
      document.querySelector<HTMLElement>('div[contenteditable="true"]')
    );
  }

  private findSendButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('div[role="button"][aria-label*="发送"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="发送"]') ||
      document.querySelector<HTMLElement>('div[class*="send-button"]') ||
      document.querySelector<HTMLElement>('div[role="button"]:has(svg)')
    );
  }

  private findStopButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('div[role="button"][aria-label*="停止"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="停止"]') ||
      document.querySelector<HTMLElement>('div[class*="stop"]') ||
      document.querySelector<HTMLElement>('div[aria-label*="Stop"]')
    );
  }

  private findLatestAssistantMessageElement(): HTMLElement | null {
    // DeepSeek 回答通常在 .ds-markdown 类或类似消息块中
    const messages = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.ds-markdown, div[class*="ds-markdown"], div[class*="message-content"], div[class*="assistant"]'
      )
    );
    if (messages.length === 0) return null;
    return messages[messages.length - 1] ?? null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

export const deepSeekAdapter = new DeepSeekAdapter();
