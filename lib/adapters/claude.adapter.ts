import type { AISiteAdapter } from './base';
import { adapterRegistry } from './base';
import type { SupportedSite } from '../types/review-job';
import { simulateTextInput } from '../utils/insert-text';
import { stripThinkBlocks } from '../utils/think-block-strip';
import { domToMarkdown } from '../utils/dom-to-markdown';
import { QuadSignalDoneDetector } from '../utils/done-detector';
import { hasElementWithText } from '../utils/dom-checker';

export class ClaudeAdapter implements AISiteAdapter {
  public readonly siteName: SupportedSite = 'Claude';
  public readonly urlPattern = /^https:\/\/claude\.ai(\/.*)?$/;
  public readonly adapterVersion = '1.0.0';

  private activeDetector: QuadSignalDoneDetector | null = null;
  private currentSnapshot = '';

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
    // 1. Cloudflare 质询
    const captcha = document.querySelector(
      'iframe[src*="challenges.cloudflare.com"], #challenge-running, div[class*="turnstile"], div[id*="cf-challenge"]'
    );
    if (captcha) return 'CAPTCHA';

    // 2. 未登录检查（如重定向至 /login）
    if (window.location.pathname.startsWith('/login') || window.location.pathname.startsWith('/signup')) return 'NOT_LOGGED_IN';
    const loginLink = document.querySelector('a[href*="/login"], a[href*="/signup"]');
    if (loginLink || hasElementWithText('button, a', ['Log In', 'Sign Up', 'Sign in', '登录'])) return 'NOT_LOGGED_IN';

    // 3. 限流 / 使用额度上限检查
    const limitBanner = document.querySelector(
      'div[class*="border-danger"], div[class*="text-danger"], div[role="alert"]'
    );
    if (limitBanner) {
      const text = limitBanner.textContent?.toLowerCase() || '';
      if (text.includes('usage limit') || text.includes('free plan limit') || text.includes('rate limit')) {
        return 'RATE_LIMIT';
      }
    }

    // 4. 输入框是否存在
    const input = this.findInputElement();
    if (!input) return 'DOM_CHANGED';

    return 'OK';
  }

  /**
   * 开启新会话
   */
  public async createNewChat(): Promise<void> {
    const newChatBtn = document.querySelector<HTMLElement>(
      'a[href="/new"], a[data-testid="new-chat-button"], button[aria-label*="New chat"], button[aria-label*="新会话"]'
    );

    if (newChatBtn && window.location.pathname !== '/new' && window.location.pathname !== '/') {
      newChatBtn.click();
      await this.sleep(1000);
    } else if (window.location.pathname !== '/new' && window.location.pathname !== '/') {
      window.location.href = 'https://claude.ai/new';
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
      return true;
    }

    // 3. 降级方案：针对输入框派发 Enter 键
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
   * 验证消息是否提交成功
   */
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
      document.querySelector<HTMLElement>('button[aria-label*="Stop"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="停止响应"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="停止生成"]')
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
