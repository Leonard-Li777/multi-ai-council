import type { AISiteAdapter } from './base';
import { adapterRegistry } from './base';
import type { SupportedSite } from '../types/review-job';
import { simulateTextInput } from '../utils/insert-text';
import { stripThinkBlocks } from '../utils/think-block-strip';
import { domToMarkdown } from '../utils/dom-to-markdown';
import { QuadSignalDoneDetector } from '../utils/done-detector';
import { isLoginButtonPresent } from '../utils/dom-checker';

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
    // 1. 若输入框已就绪，说明完全处于聊天界面，优先判定就绪
    const input = this.findInputElement();
    if (input) {
      const captcha = document.querySelector('iframe[src*="challenges.cloudflare.com"], #geetest_holder, div[class*="captcha"]');
      if (captcha) return 'CAPTCHA';
      return 'OK';
    }

    // 2. 检查人机验证 (Cloudflare Turnstile / Geetest)
    const captcha = document.querySelector('iframe[src*="challenges.cloudflare.com"], #geetest_holder, div[class*="captcha"]');
    if (captcha) return 'CAPTCHA';

    // 3. 检查是否处于真实未登录页面
    if (
      window.location.pathname.includes('/sign_in') ||
      window.location.pathname.includes('/login') ||
      isLoginButtonPresent()
    ) {
      return 'NOT_LOGGED_IN';
    }

    return 'DOM_CHANGED';
  }

  /**
   * 开启新会话
   */
  public async createNewChat(): Promise<void> {
    const newChatBtn = document.querySelector<HTMLElement>(
      'div[role="button"][class*="new"], a[href="/"], div[class*="new-chat"]'
    );
    if (newChatBtn && window.location.pathname !== '/') {
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

    await this.sleep(300);

    // 2. 点击发送按钮
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
   * 验证消息是否成功提交
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
    // 补救：若 2 秒后仍未触发生成，尝试补发一次 Enter
    const input = this.findInputElement();
    if (input) {
      input.focus();
      const eventInit: KeyboardEventInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
      input.dispatchEvent(new KeyboardEvent('keydown', eventInit));
      input.dispatchEvent(new KeyboardEvent('keyup', eventInit));
      await this.sleep(200);
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
    // 1. 精确语义选择器
    const direct = document.querySelector<HTMLElement>(
      'div[role="button"][aria-label*="发送"], button[aria-label*="发送"], div[role="button"][aria-label*="Send"], button[aria-label*="Send"], div[class*="send-button"], button[class*="send"]'
    );
    if (direct) return direct;

    // 2. 限制在输入容器内查找 svg 按钮，严禁全局 div:has(svg)
    const input = this.findInputElement();
    const container = input ? (input.closest('form, div[class*="input"], div[class*="chat-box"], div[class*="bottom"], main') as HTMLElement | null) : null;
    if (container) {
      const candidates = Array.from(container.querySelectorAll<HTMLElement>('div[role="button"], button'));
      const sendCandidate = candidates.reverse().find(b => {
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        if (aria.includes('file') || aria.includes('upload') || aria.includes('attach') || aria.includes('think') || aria.includes('search')) return false;
        return b.querySelector('svg') !== null;
      });
      if (sendCandidate) return sendCandidate;
    }
    return null;
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
adapterRegistry.register(deepSeekAdapter);
