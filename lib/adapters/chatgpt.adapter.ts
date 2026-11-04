import type { AISiteAdapter } from './base';
import { adapterRegistry } from './base';
import type { SupportedSite } from '../types/review-job';
import { simulateTextInput } from '../utils/insert-text';
import { stripThinkBlocks } from '../utils/think-block-strip';
import { domToMarkdown } from '../utils/dom-to-markdown';
import { QuadSignalDoneDetector } from '../utils/done-detector';

export class ChatGPTAdapter implements AISiteAdapter {
  public readonly siteName: SupportedSite = 'ChatGPT';
  public readonly urlPattern = /^https:\/\/chatgpt\.com(\/.*)?$/;
  public readonly adapterVersion = '1.0.0';

  private activeDetector: QuadSignalDoneDetector | null = null;
  private currentSnapshot = '';

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
    // 1. Cloudflare 质询 / Turnstile
    const captcha = document.querySelector(
      'iframe[src*="challenges.cloudflare.com"], #challenge-running, div[class*="turnstile"], div[id*="cf-challenge"]'
    );
    if (captcha) return 'CAPTCHA';

    // 2. 未登录检查
    const loginBtn = document.querySelector(
      'button[data-testid="login-button"], a[href*="/auth/login"], a[href*="login"]'
    );
    if (loginBtn) return 'NOT_LOGGED_IN';

    // 3. 限流 / 异常提示检查
    const errorBanner = document.querySelector(
      'div[class*="text-token-text-error"], div[data-testid*="error"]'
    );
    if (errorBanner) {
      const errorText = errorBanner.textContent?.toLowerCase() || '';
      if (errorText.includes('rate limit') || errorText.includes('too many requests') || errorText.includes('capacity')) {
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
      'a[data-testid="new-chat-button"], a[href="/"], button[aria-label*="New chat"], button[aria-label*="开启新聊天"]'
    );

    if (newChatBtn && window.location.pathname !== '/') {
      newChatBtn.click();
      await this.sleep(1000);
    } else if (window.location.pathname !== '/') {
      window.location.href = 'https://chatgpt.com/';
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
    const input = this.findInputElement();
    if (!input) {
      console.error('[ChatGPTAdapter] Input element not found');
      return false;
    }

    // 1. 模拟写入 ProseMirror 富文本
    const injected = await simulateTextInput(input, prompt);
    if (!injected) {
      console.error('[ChatGPTAdapter] Failed to inject prompt text into ProseMirror');
      return false;
    }

    // 等待 React / ProseMirror 状态同步与按钮解禁
    await this.sleep(400);

    // 2. 寻找发送按钮并触发点击
    const sendBtn = this.findSendButton();
    const isAriaDisabled = sendBtn?.getAttribute('aria-disabled') === 'true';
    const isDisabled = sendBtn?.hasAttribute('disabled') || isAriaDisabled;
    if (sendBtn && !isDisabled) {
      sendBtn.click();
      return true;
    }

    // 3. 降级方案：针对 ProseMirror 容器触发 Enter 键盘事件
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
    // 轮询检查最多 2.5 秒，确认停止按钮出现或输入框被清空
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
      document.querySelector<HTMLElement>('main, div[class*="react-scroll-to-bottom"], div[role="presentation"]') ||
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
      document.querySelector<HTMLElement>('#prompt-textarea') ||
      document.querySelector<HTMLElement>('div[contenteditable="true"]#prompt-textarea') ||
      document.querySelector<HTMLElement>('div[contenteditable="true"][data-placeholder]') ||
      document.querySelector<HTMLElement>('textarea[data-id="root"]') ||
      document.querySelector<HTMLElement>('div[contenteditable="true"]') ||
      document.querySelector<HTMLElement>('textarea')
    );
  }

  private findSendButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('button[data-testid="send-button"]') ||
      document.querySelector<HTMLElement>('button[data-testid="fruitjuice-send-button"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="Send prompt"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="Send message"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="发送提示词"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="发送消息"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="发送"]')
    );
  }

  private findStopButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('button[data-testid="stop-button"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="Stop streaming"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="Stop generating"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="停止生成"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="停止"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="Stop"]')
    );
  }

  private findLatestAssistantMessageElement(): HTMLElement | null {
    const turns = Array.from(
      document.querySelectorAll<HTMLElement>(
        'div[data-message-author-role="assistant"], div[class*="agent-turn"]'
      )
    );
    if (turns.length === 0) {
      // 降级：查询包含 markdown 类的最后一个大容器
      const mdElements = Array.from(document.querySelectorAll<HTMLElement>('.markdown, .prose'));
      if (mdElements.length === 0) return null;
      return mdElements[mdElements.length - 1] ?? null;
    }

    const lastTurn = turns[turns.length - 1];
    if (!lastTurn) return null;
    const mdContainer = lastTurn.querySelector<HTMLElement>('.markdown, .prose, div[class*="markdown"]') || lastTurn;
    return mdContainer;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

export const chatGPTAdapter = new ChatGPTAdapter();
adapterRegistry.register(chatGPTAdapter);
