import type { AISiteAdapter } from './base';
import { adapterRegistry } from './base';
import type { SupportedSite } from '../types/review-job';
import { simulateTextInput } from '../utils/insert-text';
import { stripThinkBlocks } from '../utils/think-block-strip';
import { domToMarkdown } from '../utils/dom-to-markdown';
import { QuadSignalDoneDetector } from '../utils/done-detector';
import { isLoginButtonPresent } from '../utils/dom-checker';

export class WenxinAdapter implements AISiteAdapter {
  public readonly siteName: SupportedSite = 'Wenxin';
  public readonly urlPattern = /^https:\/\/(wenxin|yiyan)\.baidu\.com(\/.*)?$/;
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

  public async isReady(): Promise<boolean> {
    const input = this.findInputElement();
    return input !== null;
  }

  public async checkBlocker(): Promise<'OK' | 'CAPTCHA' | 'RATE_LIMIT' | 'NOT_LOGGED_IN' | 'DOM_CHANGED'> {
    // 1. 若输入框已存在，绝非未登录
    const input = this.findInputElement();
    if (input) {
      const captcha = document.querySelector('div[class*="vcode"], div[class*="captcha"], #pass-dialog');
      if (captcha) return 'CAPTCHA';
      return 'OK';
    }

    // 2. 人机验证
    const captcha = document.querySelector('div[class*="vcode"], div[class*="captcha"], #pass-dialog');
    if (captcha) return 'CAPTCHA';

    // 3. 百度登录弹窗或未登录
    if (
      document.querySelector('#passport-login-pop, div[class*="login-dialog"], a[href*="passport.baidu.com"]') !== null ||
      isLoginButtonPresent()
    ) {
      return 'NOT_LOGGED_IN';
    }

    // 4. 限流
    const limit = document.querySelector('div[class*="limit-tip"], div[class*="warn-text"]');
    if (limit) return 'RATE_LIMIT';

    return 'DOM_CHANGED';
  }

  /**
   * 检查页面当前是否已存在历史消息
   */
  public hasExistingMessages(): boolean {
    return this.findLatestAssistantMessageElement() !== null;
  }

  public async createNewChat(): Promise<void> {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('div[role="button"], button, span, a'));
    const newChatBtn = candidates.find((el) => {
      const isLogo = el.classList.contains('logo') || el.closest('[class*="logo"]') !== null;
      if (isLogo) return false;
      const text = (el.innerText || el.textContent || '').trim().toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
      return (
        text.includes('新建对话') ||
        text.includes('新建会话') ||
        text.includes('新对话') ||
        text.includes('新会话') ||
        text.includes('new chat') ||
        aria.includes('新建对话') ||
        aria.includes('新建会话') ||
        aria.includes('新对话') ||
        aria.includes('new chat')
      );
    });

    if (newChatBtn) {
      newChatBtn.click();
      await this.sleep(600);
    }
  }

  public getConversationUrl(): string {
    return window.location.href;
  }

  public async sendPrompt(prompt: string): Promise<boolean> {
    this.recordBaseline();

    // 1. 轮询等待输入框挂载就绪 (最多等待 8 秒)
    let input: HTMLElement | null = null;
    for (let i = 0; i < 40; i++) {
      input = this.findInputElement();
      if (input && input.isConnected) break;
      await this.sleep(200);
    }
    if (!input) return false;

    const injected = await simulateTextInput(input, prompt);
    if (!injected) return false;

    await this.sleep(350);

    const sendBtn = this.findSendButton();
    const isAriaDisabled = sendBtn?.getAttribute('aria-disabled') === 'true';
    const hasDisabledClass = sendBtn?.classList.contains('disabled') || sendBtn?.classList.contains('is-disabled');
    const isDisabled = sendBtn?.hasAttribute('disabled') || isAriaDisabled || hasDisabledClass;
    if (sendBtn && !isDisabled) {
      sendBtn.click();
      await this.sleep(200);
    }

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
      input.dispatchEvent(new KeyboardEvent('keypress', eventInit));
      input.dispatchEvent(new KeyboardEvent('keyup', eventInit));
      await this.sleep(200);
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

        // 主动滚屏保持元素挂载，防止文心一言虚拟滚动卸载上部段落
        try {
          lastMsgEl.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'end' });
        } catch {}

        const currentText = (lastMsgEl.innerText || lastMsgEl.textContent || '').trim();
        if (lastMsgEl === this.baselineLastElement) {
          if (currentText.length <= this.baselineLastContent.length) {
            return '';
          }
        }

        let result = currentText;
        try {
          const md = domToMarkdown(lastMsgEl);
          if (md && md.trim().length > 0) {
            result = md;
          }
        } catch {}

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
      silenceThresholdMs: 2500,
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
    const direct = document.querySelector<HTMLElement>(
      'span[class*="sendBtn"], div[class*="sendBtn"], span[class*="send_btn"], div[class*="send_btn"], div[class*="send-btn"], span[class*="send-btn"], button[class*="send"], div[class*="enter-btn"], span[class*="submit"], div[class*="submit"], div[role="button"][aria-label*="发送"], button[aria-label*="发送"]'
    );
    if (direct) return direct;

    const input = this.findInputElement();
    const container = input ? (input.closest('form, div[class*="chat-input"], div[class*="footer"], div[class*="bottom"]') as HTMLElement | null) : null;
    if (container) {
      const candidates = Array.from(container.querySelectorAll<HTMLElement>('div[role="button"], span[role="button"], button'));
      const candidate = candidates.reverse().find(b => {
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        if (aria.includes('file') || aria.includes('upload') || aria.includes('plugin')) return false;
        return b.querySelector('svg') !== null;
      });
      if (candidate) return candidate;
    }
    return null;
  }

  private findStopButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('span[class*="stop"]') ||
      document.querySelector<HTMLElement>('button[class*="stop"]') ||
      document.querySelector<HTMLElement>('div[class*="stop-btn"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="停止"]')
    );
  }

  public dismissDialogs(): boolean {
    const dialogButtons = Array.from(
      document.querySelectorAll<HTMLElement>(
        'div[role="dialog"] button, div[class*="modal"] button, div[class*="dialog"] button'
      )
    );
    let dismissed = false;
    for (const btn of dialogButtons) {
      const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
      if (
        text.includes('确定') ||
        text.includes('知道了') ||
        text.includes('重试') ||
        text.includes('关闭') ||
        text.includes('ok') ||
        text.includes('dismiss')
      ) {
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

  private findLatestAssistantMessageElement(): HTMLElement | null {
    // 1. 查找所有机器人回答轮次的最外层卡片容器（确保包含整个回答的所有段落与代码块）
    const turnSelectors = [
      'div[class*="chat-item-robot"]',
      'div[class*="robot-item"]',
      'div[class*="robot_item"]',
      'div[class*="ans-item"]',
      'div[class*="answer-item"]',
      'div[class*="dialogue-item"]:not([class*="user"])',
      'div[class*="chat-message"]:not([class*="user"])',
    ];

    const turns = Array.from(document.querySelectorAll<HTMLElement>(turnSelectors.join(', ')));
    if (turns.length > 0) {
      const lastTurn = turns[turns.length - 1]!;
      // 检查该轮次内部是否有主内容区域；若有多个段落，直接返回整张卡片由 domToMarkdown 统筹解析
      const contentEl = lastTurn.querySelector<HTMLElement>('div[class*="eb-markdown"], div[class*="robot-content"], div[class*="md-view"]');
      return contentEl || lastTurn;
    }

    // 2. 降级：查询页面中所有的 eb-markdown 容器
    const mdList = Array.from(document.querySelectorAll<HTMLElement>('div[class*="eb-markdown"], div[class*="robot-content"], div[class*="markdown-body"]'));
    if (mdList.length > 0) {
      return mdList[mdList.length - 1] ?? null;
    }

    // 3. 降级：寻找聊天区域内的非用户消息
    const allBubbles = Array.from(document.querySelectorAll<HTMLElement>('main div[class*="content"], div[class*="chat"] div[class*="message"], div[class*="dialogue"] div[class*="item"]'));
    const nonUserBubbles = allBubbles.filter(b => {
      const cls = (b.className || '').toLowerCase();
      return !cls.includes('user') && !cls.includes('self') && !cls.includes('human');
    });
    if (nonUserBubbles.length > 0) {
      return nonUserBubbles[nonUserBubbles.length - 1] ?? null;
    }

    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

export const wenxinAdapter = new WenxinAdapter();
adapterRegistry.register(wenxinAdapter);
