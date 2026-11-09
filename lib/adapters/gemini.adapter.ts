import type { AISiteAdapter } from './base';
import { adapterRegistry } from './base';
import type { SupportedSite } from '../types/review-job';
import { simulateTextInput } from '../utils/insert-text';
import { stripThinkBlocks } from '../utils/think-block-strip';
import { domToMarkdown } from '../utils/dom-to-markdown';
import { QuadSignalDoneDetector } from '../utils/done-detector';
import { isLoginButtonPresent } from '../utils/dom-checker';
import { flightRecorder } from '../logger/flight-recorder';

export class GeminiAdapter implements AISiteAdapter {
  public readonly siteName: SupportedSite = 'Gemini';
  public readonly urlPattern = /^https:\/\/gemini\.google\.com(\/.*)?$/;
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
    // 1. 若输入框已就绪，绝非未登录
    const input = this.findInputElement();
    if (input) {
      return 'OK';
    }

    // 2. Google 登录态检查
    if (
      window.location.href.includes('accounts.google.com') ||
      document.querySelector('a[href*="accounts.google.com"], a[href*="/signin"]') !== null ||
      isLoginButtonPresent()
    ) {
      return 'NOT_LOGGED_IN';
    }

    // 3. 限流 / 配额超限
    const limitBanner = document.querySelector('div[class*="error-message"], div[class*="rate-limit"]');
    if (limitBanner) return 'RATE_LIMIT';

    return 'DOM_CHANGED';
  }

  /**
   * 检查页面当前是否已存在历史消息
   */
  public hasExistingMessages(): boolean {
    const msgs = document.querySelectorAll(
      'model-response, div[class*="model-response"], div[class*="response-container"], message-content'
    );
    return msgs.length > 0;
  }

  public async createNewChat(): Promise<void> {
    const allCandidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, a, div[role="button"], span[role="button"]'
      )
    );
    const newChatBtn = allCandidates.find((el) => {
      const isLogo = el.classList.contains('logo') || el.closest('[class*="logo"]') !== null;
      if (isLogo) return false;
      const text = (el.innerText || el.textContent || '').trim().toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
      return (
        text.includes('new chat') ||
        text.includes('新对话') ||
        text.includes('新建对话') ||
        aria.includes('new chat') ||
        aria.includes('新对话') ||
        aria.includes('新建对话') ||
        el.getAttribute('data-test-id')?.includes('new-chat')
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

    const input = this.findInputElement();
    if (!input) return false;

    // Gemini 使用 Quill 富文本编辑器 (div.ql-editor)
    const injected = await simulateTextInput(input, prompt);
    if (!injected) return false;

    await this.sleep(350);

    const sendBtn = this.findSendButton();
    const isAriaDisabled = sendBtn?.getAttribute('aria-disabled') === 'true';
    const isDisabled = sendBtn?.hasAttribute('disabled') || isAriaDisabled;
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
      document.querySelector<HTMLElement>('main, div[class*="chat-history"], div[class*="conversation-container"]') ||
      document.body;

    this.activeDetector = new QuadSignalDoneDetector({
      getStopButton: () => this.findStopButton(),
      getSendButton: () => this.findSendButton(),
      getCurrentContent: () => {
        const lastMsgEl = this.findLatestAssistantMessageElement();
        if (!lastMsgEl) return '';

        const currentText = (lastMsgEl.innerText || lastMsgEl.textContent || '').trim();
        if (lastMsgEl === this.baselineLastElement) {
          if (currentText.length <= this.baselineLastContent.length) {
            return '';
          }
        }

        // 核心：从轮次或父级容器中提取全部 message-content 段落，实现全量合并杜绝截断
        const msgContents = Array.from(lastMsgEl.querySelectorAll<HTMLElement>('message-content')).filter(
          (el) => (el.innerText || el.textContent || '').trim().length > 0
        );

        let result = '';
        if (msgContents.length > 0) {
          // 将所有段落（含代码块、列表）逐段转换为 Markdown 并拼接
          result = msgContents
            .map((el) => {
              const clone = el.cloneNode(true) as HTMLElement;
              clone.querySelectorAll('button, [class*="footer"], [class*="toolbar"]').forEach((b) => b.remove());
              const md = domToMarkdown(clone);
              return (md && md.trim().length > 0) ? md : (clone.innerText || clone.textContent || '').trim();
            })
            .filter(Boolean)
            .join('\n\n');
        } else {
          // 若无独立 message-content 标签，清理 targetEl 后兜底提取
          let targetEl = lastMsgEl;
          const noisyNodes = targetEl.querySelectorAll(
            'div[class*="footer"], div[class*="toolbar"], div[class*="header"], [role="toolbar"], button, [class*="response-container-footer"]'
          );
          if (noisyNodes.length > 0) {
            const clone = targetEl.cloneNode(true) as HTMLElement;
            clone
              .querySelectorAll('div[class*="footer"], div[class*="toolbar"], div[class*="header"], [role="toolbar"], button, [class*="response-container-footer"]')
              .forEach((n) => n.remove());
            targetEl = clone;
          }
          result = (targetEl.innerText || targetEl.textContent || '').trim();
          try {
            const md = domToMarkdown(targetEl);
            if (md && md.trim().length > 0) {
              result = md;
            }
          } catch {}
        }

        // 核心防护：若当前内容完全属于思考块或少于 20 字符的模型名字/占位符（如 "Gemini 2.0 Flash"），返回空以令 Detector 保持守候
        const { cleaned } = stripThinkBlocks(result);
        if (cleaned.length < 20) {
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
      silenceThresholdMs: 3500,
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
    // 1. 精确语义选择器
    const direct = document.querySelector<HTMLElement>(
      'button[aria-label*="Send message"], button[aria-label*="发送消息"], button[aria-label*="Send"], button[aria-label*="发送"], button.send-button, button[data-test-id="send-button"]'
    );
    if (direct) return direct;

    // 2. 限制在输入容器内查找 svg 按钮，严禁全局 button:has(svg)
    const input = this.findInputElement();
    const container = input ? (input.closest('rich-textarea, div[class*="input-area"], div[class*="text-input"], form') as HTMLElement | null) : null;
    if (container) {
      const candidates = Array.from(container.querySelectorAll<HTMLElement>('button'));
      const candidate = candidates.reverse().find(b => {
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        if (aria.includes('mic') || aria.includes('upload') || aria.includes('voice') || aria.includes('file')) return false;
        return b.querySelector('svg') !== null || b.classList.contains('send-button');
      });
      if (candidate) return candidate;
    }
    return null;
  }

  public dismissDialogs(): boolean {
    const dialogButtons = Array.from(
      document.querySelectorAll<HTMLElement>(
        'div[role="dialog"] button, div[class*="modal"] button, mat-dialog-container button'
      )
    );
    let dismissed = false;
    for (const btn of dialogButtons) {
      const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
      if (
        text.includes('dismiss') ||
        text.includes('ok') ||
        text.includes('got it') ||
        text.includes('reload') ||
        text.includes('确定') ||
        text.includes('知道了') ||
        text.includes('关闭')
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

  private findStopButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('button[aria-label*="Stop"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="停止"]') ||
      document.querySelector<HTMLElement>('div[role="button"][aria-label*="Stop"]') ||
      document.querySelector<HTMLElement>('div[role="button"][aria-label*="停止"]') ||
      document.querySelector<HTMLElement>('button[data-test-id*="stop"]') ||
      document.querySelector<HTMLElement>('button.stop-button')
    );
  }

  private findLatestAssistantMessageElement(): HTMLElement | null {
    // 1. 查找所有 model-response 消息卡片（严格排除独立的 footer/header/toolbar）
    const modelResponses = Array.from(
      document.querySelectorAll<HTMLElement>(
        'model-response, [data-test-id*="model-response"], div[class*="model-response"], div[class*="model-turn"]'
      )
    ).filter((el) => {
      const cls = (el.className || '').toString().toLowerCase();
      return !cls.includes('footer') && !cls.includes('header') && !cls.includes('toolbar') && !cls.includes('action');
    });

    if (modelResponses.length > 0) {
      const last = modelResponses[modelResponses.length - 1]!;
      // 核心要求：最新轮次内必须已经出现真正的正文段落（message-content 或 markdown 面板）
      const hasContent = last.querySelector<HTMLElement>(
        'message-content, div.markdown, div[class*="markdown"], div[class*="response-container-content"]'
      );
      if (hasContent && (hasContent.innerText || hasContent.textContent || '').trim().length > 0) {
        return last;
      }
    }

    // 2. 降级：直接寻找页面上的 message-content 正文容器
    const allMsgContents = Array.from(document.querySelectorAll<HTMLElement>('message-content')).filter(
      (el) => (el.innerText || el.textContent || '').trim().length > 0
    );
    if (allMsgContents.length > 0) {
      const lastContent = allMsgContents[allMsgContents.length - 1]!;
      const parentTurn = lastContent.closest<HTMLElement>(
        'model-response, div[class*="response-container"], div[class*="model-response"]'
      );
      return parentTurn || lastContent;
    }

    // 3. 降级：直接寻找页面上的 markdown 主面板
    const contents = Array.from(
      document.querySelectorAll<HTMLElement>(
        'div[class*="model-response-text"], div[class*="markdown-main-panel"], div.markdown'
      )
    ).filter((el) => (el.innerText || el.textContent || '').trim().length > 0);
    if (contents.length > 0) {
      return contents[contents.length - 1] ?? null;
    }

    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

export const geminiAdapter = new GeminiAdapter();
adapterRegistry.register(geminiAdapter);
