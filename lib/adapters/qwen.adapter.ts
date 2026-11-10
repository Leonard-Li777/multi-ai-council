import type { AISiteAdapter } from './base';
import { adapterRegistry } from './base';
import type { SupportedSite } from '../types/review-job';
import { simulateTextInput } from '../utils/insert-text';
import { stripThinkBlocks } from '../utils/think-block-strip';
import { domToMarkdown } from '../utils/dom-to-markdown';
import { QuadSignalDoneDetector } from '../utils/done-detector';
import { isLoginButtonPresent } from '../utils/dom-checker';
import { flightRecorder } from '../logger/flight-recorder';

export class QwenAdapter implements AISiteAdapter {
  public readonly siteName: SupportedSite = 'Qwen';
  public readonly urlPattern = /^https:\/\/chat\.qwen\.ai(\/.*)?$/;
  public readonly adapterVersion = '1.0.0';

  private activeDetector: QuadSignalDoneDetector | null = null;
  private currentSnapshot = '';
  private highWaterMarkSnapshot = '';
  private baselineLastElement: HTMLElement | null = null;
  private baselineLastContent = '';
  private lastPrompt = '';

  public recordBaseline(): void {
    const el = this.findLatestAssistantMessageElement();
    this.baselineLastElement = el;
    this.baselineLastContent = el ? (domToMarkdown(el) || el.innerText || el.textContent || '').trim() : '';
    this.highWaterMarkSnapshot = '';
  }

  public async isReady(): Promise<boolean> {
    const input = this.findInputElement();
    return input !== null;
  }

  public async checkBlocker(): Promise<'OK' | 'CAPTCHA' | 'RATE_LIMIT' | 'NOT_LOGGED_IN' | 'DOM_CHANGED'> {
    // 1. 若输入框已存在，绝非未登录
    const input = this.findInputElement();
    if (input) {
      const captcha = document.querySelector(
        'iframe[src*="captcha"], #baxia-dialog-content, div[class*="nc-container"], div[class*="captcha"]'
      );
      if (captcha) return 'CAPTCHA';
      return 'OK';
    }

    // 2. 人机验证
    const captcha = document.querySelector(
      'iframe[src*="captcha"], #baxia-dialog-content, div[class*="nc-container"], div[class*="captcha"]'
    );
    if (captcha) return 'CAPTCHA';

    // 3. 未登录检查
    if (
      window.location.pathname.includes('/login') ||
      document.querySelector('div[class*="login-button"]') !== null ||
      isLoginButtonPresent()
    ) {
      return 'NOT_LOGGED_IN';
    }

    // 4. 限流检查
    const errorBanner = document.querySelector('div[class*="error-tip"], div[class*="rate-limit"]');
    if (errorBanner) return 'RATE_LIMIT';

    return 'DOM_CHANGED';
  }

  /**
   * 检查页面当前是否已存在历史消息
   */
  public hasExistingMessages(): boolean {
    const msgs = document.querySelectorAll(
      'div[class*="qwen-markdown"], div[class*="message-item-bot"], div[class*="bubble-content"], div[class*="assistant"]'
    );
    return msgs.length > 0;
  }

  public async createNewChat(): Promise<void> {
    // 关键优化：若当前页面本无历史消息，切勿重复点击 New Chat 避免触发 SPA 页面硬刷新自杀
    if (!this.hasExistingMessages()) {
      return;
    }

    const allCandidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, div[role="button"], span[role="button"]'
      )
    );
    const newChatBtn = allCandidates.find((el) => {
      const isLogo = el.classList.contains('logo') || el.closest('[class*="logo"]') !== null;
      if (isLogo) return false;
      const text = (el.innerText || el.textContent || '').trim().toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
      const title = (el.getAttribute('title') || '').trim().toLowerCase();
      return (
        text === '新对话' ||
        text === '新建对话' ||
        text === '新会话' ||
        text === '新建会话' ||
        text === 'new chat' ||
        aria.includes('新对话') ||
        aria.includes('新建对话') ||
        aria.includes('新会话') ||
        title.includes('新对话') ||
        el.getAttribute('data-testid')?.includes('new-chat')
      );
    });

    if (newChatBtn) {
      newChatBtn.click();
      await this.sleep(400);
    }
  }

  /**
   * 自动切换模型至 Qwen 3.8 Max (或指定模型名称)
   */
  public async switchModel(targetModel = '3.8-Max'): Promise<boolean> {
    try {
      const normalizedTarget = targetModel.toLowerCase().replace(/[\s\-_]/g, '');

      // 1. 查找模型下拉触发器
      const triggers = Array.from(
        document.querySelectorAll<HTMLElement>(
          'div[class*="model"], button[class*="model"], span[class*="model"], header div[role="button"], header button, [aria-haspopup="listbox"], [aria-haspopup="menu"]'
        )
      );

      let trigger = triggers.find((t) => {
        const text = (t.innerText || t.textContent || '').toLowerCase().replace(/[\s\-_]/g, '');
        return text.includes('qwen') || text.includes('max') || text.includes('3.8');
      });

      if (!trigger) {
        const clickables = Array.from(document.querySelectorAll<HTMLElement>('div[role="button"], button'));
        trigger = clickables.find((el) => {
          const t = (el.innerText || '').toLowerCase();
          return (t.includes('qwen') || t.includes('max')) && !el.closest('form, div[class*="input"]');
        });
      }

      if (trigger) {
        const currentText = (trigger.innerText || trigger.textContent || '').toLowerCase().replace(/[\s\-_]/g, '');
        // 若当前已经包含 max 或 3.8 或目标型号，说明已经是所需模型，绝不重新点击展开下拉框扰乱焦点或打断用户手动选择
        if (
          currentText.includes(normalizedTarget) ||
          currentText.includes('max') ||
          currentText.includes('3.8')
        ) {
          console.log('[QwenAdapter] Already on target/Max model:', currentText);
          return true;
        }

        // 点击展开下拉框
        trigger.click();
        await this.sleep(600);

        // 在弹出的下拉浮层中寻找匹配项
        const options = Array.from(
          document.querySelectorAll<HTMLElement>(
            'div[class*="dropdown"] *, div[class*="popover"] *, div[role="option"], div[role="menuitem"], div[class*="select-item"], div[class*="model-item"], div[class*="menu-item"]'
          )
        );

        let match = options.find((el) => {
          const t = (el.innerText || el.textContent || '').toLowerCase().replace(/[\s\-_]/g, '');
          return t.includes('3.8') && t.includes('max');
        });

        if (!match) {
          match = options.find((el) => {
            const t = (el.innerText || el.textContent || '').toLowerCase().replace(/[\s\-_]/g, '');
            return t.includes('max') && !t.includes('mini');
          });
        }

        if (match) {
          match.click();
          await this.sleep(400);
          console.log('[QwenAdapter] Successfully switched model to:', match.innerText);
          return true;
        }

        document.body.click();
      }
    } catch (e) {
      console.warn('[QwenAdapter] switchModel error:', e);
    }
    return false;
  }

  public getConversationUrl(): string {
    return window.location.href;
  }

  public async sendPrompt(prompt: string): Promise<boolean> {
    this.recordBaseline();
    this.lastPrompt = prompt;

    const input = this.findInputElement();
    if (!input) {
      flightRecorder.error('Qwen', 'INPUT_NOT_FOUND');
      return false;
    }

    flightRecorder.info('Qwen', 'INPUT_FOUND', { tag: input.tagName, promptLen: prompt.length });

    const injected = await simulateTextInput(input, prompt);
    if (!injected) {
      flightRecorder.error('Qwen', 'PROMPT_INJECT_FAILED');
      return false;
    }

    flightRecorder.info('Qwen', 'PROMPT_INJECT_SUCCESS', { promptLen: prompt.length });

    await this.sleep(400);

    const sendBtn = this.findSendButton();
    const isAriaDisabled = sendBtn?.getAttribute('aria-disabled') === 'true';
    const isDisabled = sendBtn?.hasAttribute('disabled') || isAriaDisabled;
    if (sendBtn && !isDisabled) {
      sendBtn.click();
      sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      flightRecorder.info('Qwen', 'SEND_BUTTON_CLICKED');
      await this.sleep(300);
    } else {
      flightRecorder.warn('Qwen', 'SEND_BUTTON_DISABLED_OR_NOT_FOUND', { exists: !!sendBtn, isDisabled });
    }

    // 尝试通过原生表单 requestSubmit() 提交
    const form = input.closest('form');
    if (form && !this.findStopButton()) {
      try {
        form.requestSubmit();
        flightRecorder.info('Qwen', 'FORM_REQUEST_SUBMIT_CALLED');
        await this.sleep(200);
      } catch {}
    }

    // 始终派发 Enter 保底
    if (!this.findStopButton()) {
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
      flightRecorder.info('Qwen', 'ENTER_KEY_DISPATCHED');
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
      document.querySelector<HTMLElement>('main, div[class*="chat-container"], div[class*="message-list"]') ||
      document.body;

    this.activeDetector = new QuadSignalDoneDetector({
      getStopButton: () => this.findStopButton(),
      getSendButton: () => this.findSendButton(),
      getCurrentContent: () => {
        const lastUserEl = this.findLatestUserMessageElement();
        let candidateContainers: HTMLElement[] = [];

        // 1. 若定位到了用户最后一条输入，获取在其后生成的所有 markdown 正文容器（彻底防止多卡片被截断）
        if (lastUserEl) {
          const allMd = Array.from(
            document.querySelectorAll<HTMLElement>('div.qwen-markdown, div.markdown-body, div[class*="markdown"]')
          ).filter((el) => {
            const userAncestor = el.closest('[class*="user"], [class*="question"], [class*="query"], [data-role="user"], [class*="prompt"]');
            if (userAncestor) return false;
            const cls = (el.className || '').toString().toLowerCase();
            if (cls.includes('user') || cls.includes('question') || cls.includes('query')) return false;
            return (lastUserEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
          });

          candidateContainers = allMd.filter((el) => {
            return !el.parentElement?.closest('div.qwen-markdown, div.markdown-body, div[class*="markdown"]');
          });
        }

        // 2. 提取文本：优先聚合用户输入后渲染的全部顶层容器
        let result = '';
        if (candidateContainers.length > 0) {
          result = candidateContainers
            .map((el) => {
              const clone = el.cloneNode(true) as HTMLElement;
              clone
                .querySelectorAll(
                  'div[class*="think"], div[class*="reasoning"], div[class*="thought"], [class*="think-container"], div[class*="action"], div[class*="toolbar"], div[class*="footer"], div[class*="header"], [role="toolbar"], button, div[class*="avatar"], div[class*="icon"]'
                )
                .forEach((node) => node.remove());
              const md = domToMarkdown(clone);
              return (md && md.trim().length > 0) ? md : (clone.innerText || clone.textContent || '').trim();
            })
            .filter((t) => t.trim().length > 0)
            .join('\n\n');
        }

        // 3. 兜底与轮次全量合并：若按用户后序未抓到或字数较少，结合 findLatestAssistantMessageElement()
        const lastMsgEl = this.findLatestAssistantMessageElement();
        if (lastMsgEl) {
          if (lastMsgEl === this.baselineLastElement) {
            const currentText = (lastMsgEl.innerText || lastMsgEl.textContent || '').trim();
            if (currentText === this.baselineLastContent && !result) {
              return '';
            }
          }

          // DOM 克隆净化：彻底剔除思考块、工具栏与各类操作按钮
          const clone = lastMsgEl.cloneNode(true) as HTMLElement;
          clone
            .querySelectorAll(
              'div[class*="think"], div[class*="reasoning"], div[class*="thought"], [class*="think-container"], div[class*="action"], div[class*="toolbar"], div[class*="footer"], div[class*="header"], [role="toolbar"], button, div[class*="avatar"], div[class*="icon"]'
            )
            .forEach((el) => el.remove());

          // 查找所有顶层 markdown 容器
          const mdContainers = Array.from(
            clone.querySelectorAll<HTMLElement>('div.qwen-markdown, div.markdown-body, div[class*="markdown"]')
          ).filter((el) => {
            return !el.parentElement?.closest('div.qwen-markdown, div.markdown-body, div[class*="markdown"]');
          });

          if (mdContainers.length > 0 && !result) {
            result = mdContainers
              .map((el) => {
                const md = domToMarkdown(el);
                return (md && md.trim().length > 0) ? md : (el.innerText || el.textContent || '').trim();
              })
              .filter((t) => t.trim().length > 0)
              .join('\n\n');
          }

          // 核心：若 clone 全文本长度大于当前提取结果，取更完整的 fullText
          const fullMd = domToMarkdown(clone);
          const fullText = (fullMd && fullMd.trim().length > 0) ? fullMd : (clone.innerText || clone.textContent || '').trim();
          if (fullText.length > result.length) {
            result = fullText;
          }
        }
        
        // 核心防护：若当前内容完全属于思考块或少于 35 字符的思考占位，正文返回空以令 Detector 保持守候
        const { cleaned } = stripThinkBlocks(result);
        if (cleaned.length < 35) {
          return '';
        }

        // 核心防角色污染门禁：严禁将用户输入的 Prompt 误采为助手回答！
        if (this.lastPrompt.trim().length > 30) {
          const pTrim = this.lastPrompt.trim();
          const cTrim = cleaned.trim();
          const lead = pTrim.slice(0, 60);
          if (cTrim.startsWith(lead)) {
            flightRecorder.warn('Qwen', 'PROMPT_ECHO_REJECTED', { leadLen: lead.length });
            return '';
          }
          if (pTrim.includes('<review_mandate>') && cTrim.includes('<review_mandate>') && !cTrim.includes('</review_mandate>')) {
            flightRecorder.warn('Qwen', 'PROMPT_ECHO_TAG_DETECTED_REJECTED');
            return '';
          }
        }

        // Anti-Shrink 高水位快照单调保护：杜绝流式期间 DOM 偶发抖动导致字数逆向回缩
        if (cleaned.length < this.highWaterMarkSnapshot.length * 0.7) {
          return this.highWaterMarkSnapshot;
        }
        if (cleaned.length > this.highWaterMarkSnapshot.length) {
          this.highWaterMarkSnapshot = cleaned;
        }

        this.currentSnapshot = cleaned;
        return cleaned;
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
      userPrompt: this.lastPrompt,
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
      document.querySelectorAll<HTMLElement>(
        'div[role="dialog"] button, div[class*="modal"] button, div[role="alertdialog"] button, div[class*="dialog"] button'
      )
    );
    let dismissed = false;
    for (const btn of dialogButtons) {
      const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
      if (
        text.includes('dismiss') ||
        text.includes('ok') ||
        text.includes('reload') ||
        text.includes('确定') ||
        text.includes('知道了') ||
        text.includes('重试') ||
        text.includes('关闭')
      ) {
        btn.click();
        dismissed = true;
      }
    }
    return dismissed;
  }

  /**
   * 智能自愈与状态恢复
   */
  public async autoRecoverAndContinue(
    prompt: string,
    onUpdate: (snapshot: string, cleaned: string) => void,
    onDone: (finalCleaned: string) => void
  ): Promise<'DONE' | 'STREAMING' | 'SENT' | 'FAILED'> {
    this.dismissDialogs();
    await this.sleep(300);

    // 1. 若当前已产生了有效新回答，直接抓取完成
    const lastMsg = this.findLatestAssistantMessageElement();
    if (lastMsg && lastMsg !== this.baselineLastElement && !this.findStopButton()) {
      const clone = lastMsg.cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll(
          'div[class*="think"], div[class*="reasoning"], div[class*="thought"], div[class*="collapse"], [class*="think-container"], div[class*="action"], div[class*="toolbar"], div[class*="footer"], div[class*="header"], [role="toolbar"], button, div[class*="avatar"], div[class*="icon"]'
        )
        .forEach((el) => el.remove());

      const md = domToMarkdown(clone);
      const text = (md && md.trim().length > 0) ? md : (clone.innerText || clone.textContent || '').trim();
      const { cleaned } = stripThinkBlocks(text);
      if (cleaned.length > 35) {
        onDone(cleaned);
        return 'DONE';
      }
    }

    // 2. 若当前仍在流式生成中，直接挂接监听
    if (this.findStopButton()) {
      this.listenGeneration(onUpdate, onDone);
      return 'STREAMING';
    }

    // 3. 检查输入框是否已有提示词内容
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

    // 4. 输入框为空，重发提示词
    const sent = await this.sendPrompt(prompt);
    if (sent) {
      this.listenGeneration(onUpdate, onDone);
      return 'STREAMING';
    }

    return 'FAILED';
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
    const input = this.findInputElement();
    const container = input ? (input.closest('form, div[class*="chat-input"], div[class*="input"], div[class*="sender"]') as HTMLElement | null) : null;
    const searchRoot = container || document;

    // 在输入区域内查找所有候选按钮
    const candidates = Array.from(
      searchRoot.querySelectorAll<HTMLElement>(
        'button[type="submit"], button[class*="send-button"], button[class*="sendBtn"], div[class*="sendBtn"], div[class*="send-btn"], button[class*="submit"], div[class*="submit"], button[aria-label*="发送"], button[aria-label*="Send"], div[role="button"][class*="send"], button[class*="send"], button.ant-btn-primary'
      )
    );

    // 核心安全过滤：坚决剔除正在处于停止态（包含 rect、stop 语义、loading 旋转）的按钮！
    const sendBtn = candidates.find((b) => {
      if (this.isStopActionElement(b)) return false;
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      if (aria.includes('file') || aria.includes('upload') || aria.includes('attach') || aria.includes('audio')) {
        return false;
      }
      return true;
    });

    if (sendBtn) return sendBtn;

    // 兜底递归父级
    let parent = input?.parentElement;
    for (let i = 0; i < 6 && parent; i++) {
      const parentCandidates = Array.from(parent.querySelectorAll<HTMLElement>('div[role="button"], button'));
      const found = parentCandidates.reverse().find(b => {
        if (this.isStopActionElement(b)) return false;
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const cls = (b.className || '').toString().toLowerCase();
        const type = (b.getAttribute('type') || '').toLowerCase();
        if (aria.includes('file') || aria.includes('upload') || aria.includes('attach') || aria.includes('audio') || cls.includes('upload')) {
          return false;
        }
        return b.querySelector('svg') !== null || cls.includes('send') || cls.includes('submit') || type === 'submit';
      });
      if (found) return found;
      parent = parent.parentElement;
    }
    return null;
  }

  private isStopActionElement(el: HTMLElement | null): boolean {
    if (!el) return false;
    const aria = (el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
    if (aria.includes('停止') || aria.includes('stop') || aria.includes('pause') || aria.includes('取消生成')) {
      return true;
    }
    const cls = (el.className || '').toString().toLowerCase();
    if (cls.includes('stop') || cls.includes('loading') || cls.includes('ant-btn-loading')) {
      return true;
    }
    // 检查是否包含方形停止图标（如 <rect> 或含 stop 特征的 SVG）
    if (el.querySelector('rect, [class*="stop"], [class*="pause"], [class*="square"]')) {
      return true;
    }
    return false;
  }

  private findStopButton(): HTMLElement | null {
    const input = this.findInputElement();
    const container = input ? (input.closest('form, div[class*="chat-input"], div[class*="input"], div[class*="sender"]') as HTMLElement | null) : null;
    const searchRoot = container || document;

    // 1. 查找输入区域内明确具备 stop 特征的按钮
    const candidates = Array.from(
      searchRoot.querySelectorAll<HTMLElement>(
        'button, div[role="button"], span[role="button"]'
      )
    );
    const stopBtn = candidates.find((b) => this.isStopActionElement(b));
    if (stopBtn) return stopBtn;

    // 2. 兜底全局选择器
    return (
      searchRoot.querySelector<HTMLElement>('button[aria-label*="停止"], button[aria-label*="Stop"]') ||
      searchRoot.querySelector<HTMLElement>('button[class*="stop"]') ||
      searchRoot.querySelector<HTMLElement>('div[class*="stop-btn"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="停止"], button[aria-label*="Stop"]') ||
      document.querySelector<HTMLElement>('button[class*="stop"]') ||
      document.querySelector<HTMLElement>('div[class*="stop-btn"]')
    );
  }

  private findLatestUserMessageElement(): HTMLElement | null {
    const userNodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        'div[class*="chat-item-user"], div[class*="message-item-user"], div[class*="user-item"], div[class*="message-user"], div[class*="user-message"], [data-role="user"], div[class*="chat-message"][class*="user"], div[class*="user"]'
      )
    ).filter((el) => {
      const cls = (el.className || '').toString().toLowerCase();
      return (
        !cls.includes('input') &&
        !cls.includes('fixed') &&
        !cls.includes('editor') &&
        !cls.includes('textarea') &&
        !cls.includes('header') &&
        !cls.includes('dialog')
      );
    });
    return userNodes.length > 0 ? userNodes[userNodes.length - 1]! : null;
  }

  private findLatestAssistantMessageElement(): HTMLElement | null {
    // 1. 查找所有机器人轮次外层卡片（严格排除底部固定输入框、编辑器容器与任何用户卡片）
    const turns = Array.from(
      document.querySelectorAll<HTMLElement>(
        'div[class*="chat-item-assistant"], div[class*="message-item-assistant"], div[class*="assistant-item"], div[class*="message-assistant"], div[class*="assistant-message"], div[class*="chat-message"]:not([class*="user"]):not([class*="input"]):not([class*="fixed"]):not([class*="bottom"]):not([class*="editor"]):not([class*="textarea"])'
      )
    ).filter((el) => {
      const cls = (el.className || '').toString().toLowerCase();
      // 坚决排除任何包含 input、fixed、editor、user、query、question 的卡片
      return (
        !cls.includes('input') &&
        !cls.includes('fixed') &&
        !cls.includes('editor') &&
        !cls.includes('user') &&
        !cls.includes('query') &&
        !cls.includes('question')
      );
    });

    if (turns.length > 0) {
      // 核心：过滤掉嵌套在其它同类候选容器内部的子元素，保证获取到的是最外层的完整轮次
      const topLevelTurns = turns.filter((el) => {
        return !el.parentElement?.closest(
          'div[class*="chat-item-assistant"], div[class*="message-item-assistant"], div[class*="assistant-item"], div[class*="message-assistant"], div[class*="assistant-message"], div[class*="chat-message"]'
        );
      });
      const candidate = (topLevelTurns.length > 0 ? topLevelTurns[topLevelTurns.length - 1] : turns[turns.length - 1]) ?? null;
      if (candidate) {
        // 二次核验：候选元素内不得包含任何代表用户角色的子元素
        if (!candidate.querySelector('[class*="user"], [class*="query"], [class*="question"], [data-role="user"]')) {
          return candidate;
        }
      }
    }

    // 2. 降级：查找 qwen-markdown 容器，但必须显式过滤用户气泡！
    const mdBodies = Array.from(
      document.querySelectorAll<HTMLElement>('div.qwen-markdown, div[class*="markdown-body"]')
    ).filter((el) => {
      // 向上溯源：若祖先节点包含 user/query/question/prompt 则坚决排除！
      const userAncestor = el.closest('[class*="user"], [class*="question"], [class*="query"], [data-role="user"], [class*="prompt"]');
      if (userAncestor) return false;
      const cls = (el.className || '').toString().toLowerCase();
      return !cls.includes('user') && !cls.includes('question') && !cls.includes('query');
    });

    if (mdBodies.length > 0) {
      return mdBodies[mdBodies.length - 1] ?? null;
    }

    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

export const qwenAdapter = new QwenAdapter();
adapterRegistry.register(qwenAdapter);
