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
  private baselineLastElement: HTMLElement | null = null;
  private baselineLastContent = '';

  public recordBaseline(): void {
    const el = this.findLatestAssistantMessageElement();
    this.baselineLastElement = el;
    this.baselineLastContent = el ? (domToMarkdown(el) || el.innerText || el.textContent || '').trim() : '';
  }

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
   * 检查页面当前是否已存在历史消息
   */
  public hasExistingMessages(): boolean {
    const msgs = document.querySelectorAll(
      '.ds-markdown, div[class*="ds-markdown"], div[class*="message-content"], div[class*="assistant"]'
    );
    return msgs.length > 0;
  }

  /**
   * 开启新会话
   */
  public async createNewChat(): Promise<void> {
    // 1. 寻找页面上的新会话入口（精准匹配，排除左上角 Logo 首页链接）
    const allCandidates = Array.from(document.querySelectorAll<HTMLElement>('div[role="button"], a, button'));
    const newChatBtn = allCandidates.find((el) => {
      const isLogo = el.classList.contains('logo') || el.closest('[class*="logo"]') !== null;
      if (isLogo) return false;
      const text = (el.innerText || el.textContent || '').trim();
      const aria = (el.getAttribute('aria-label') || '').trim();
      return (
        text === '开启新对话' ||
        text === '新对话' ||
        text === 'New chat' ||
        text.includes('开启新对话') ||
        text.includes('新建对话') ||
        aria.includes('新对话') ||
        aria.includes('新聊天') ||
        aria.includes('New chat')
      );
    });

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
   * 注入提示词并点击发送
   */
  public async sendPrompt(prompt: string): Promise<boolean> {
    // 发送前记录基线元素与内容，彻底隔离历史回合文本
    this.recordBaseline();

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

        // 若当前元素是基线元素且文本未变化，说明 AI 还未产出本次回复，返回空字符串阻断过早判定完成
        if (lastMsgEl === this.baselineLastElement) {
          const currentText = (lastMsgEl.innerText || lastMsgEl.textContent || '').trim();
          if (currentText === this.baselineLastContent) {
            return '';
          }
        }

        // 核心防护：若提取的容器中含有深度思考思维链折叠块，克隆节点并彻底剔除，只保留正式回复
        let targetEl = lastMsgEl;
        const thinkNodes = targetEl.querySelectorAll(
          'div[class*="think"], div[class*="thought"], div[class*="reasoning"], div[class*="collapse"]'
        );
        if (thinkNodes.length > 0) {
          const clone = targetEl.cloneNode(true) as HTMLElement;
          clone
            .querySelectorAll('div[class*="think"], div[class*="thought"], div[class*="reasoning"], div[class*="collapse"]')
            .forEach((n) => n.remove());
          targetEl = clone;
        }

        const md = domToMarkdown(targetEl);
        const result = (md && md.trim().length > 0) ? md : (targetEl.innerText || targetEl.textContent || '').trim();

        // 思考中防护：若清洗后正文长度为 0，说明模型仍在思考尚未吐出正文，返回空保持等待
        const { cleaned } = stripThinkBlocks(result);
        if (cleaned.length === 0) {
          return '';
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
      if (text.includes('确定') || text.includes('知道了') || text.includes('重试') || text.includes('关闭') || text.includes('ok')) {
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

  public findStopButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('div[role="button"][aria-label*="停止"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="停止"]') ||
      document.querySelector<HTMLElement>('div[class*="stop"]') ||
      document.querySelector<HTMLElement>('div[aria-label*="Stop"]')
    );
  }

  private findLatestAssistantMessageElement(): HTMLElement | null {
    // 1. 查找所有机器人轮次外层卡片（严格排除输入框）
    const turns = Array.from(
      document.querySelectorAll<HTMLElement>(
        'div[class*="chat-item-assistant"], div[class*="message-assistant"], div[class*="assistant-item"], div[class*="chat-message"]:not([class*="user"])'
      )
    ).filter((el) => {
      const cls = (el.className || '').toLowerCase();
      return !cls.includes('input') && !cls.includes('editor');
    });

    if (turns.length > 0) {
      const lastTurn = turns[turns.length - 1]!;
      // 优先在当前轮次内部寻找非思维链的正式回复 markdown 容器
      const mdElements = Array.from(
        lastTurn.querySelectorAll<HTMLElement>('.ds-markdown, div[class*="ds-markdown"], div[class*="markdown-body"]')
      ).filter((el) => {
        const isThinking = el.closest('div[class*="think"], div[class*="thought"], div[class*="reasoning"], div[class*="collapse"]') !== null;
        return !isThinking;
      });

      if (mdElements.length > 0) {
        return mdElements[mdElements.length - 1]!;
      }
      return lastTurn;
    }

    // 2. 降级：全量查找所有非思维链折叠块的 .ds-markdown
    const allMarkdown = Array.from(
      document.querySelectorAll<HTMLElement>('.ds-markdown, div[class*="ds-markdown"]')
    ).filter((el) => el.closest('div[class*="think"], div[class*="thought"], div[class*="reasoning"]') === null);

    if (allMarkdown.length > 0) {
      return allMarkdown[allMarkdown.length - 1] ?? null;
    }

    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

export const deepSeekAdapter = new DeepSeekAdapter();
adapterRegistry.register(deepSeekAdapter);
