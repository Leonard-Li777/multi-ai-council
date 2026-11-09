import type { AISiteAdapter } from './base';
import { adapterRegistry } from './base';
import type { SupportedSite } from '../types/review-job';
import { simulateTextInput } from '../utils/insert-text';
import { stripThinkBlocks } from '../utils/think-block-strip';
import { domToMarkdown } from '../utils/dom-to-markdown';
import { QuadSignalDoneDetector } from '../utils/done-detector';
import { isLoginButtonPresent } from '../utils/dom-checker';
import { flightRecorder } from '../logger/flight-recorder';

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
    if (!input) {
      flightRecorder.error('Wenxin', 'INPUT_NOT_FOUND_AFTER_POLLING');
      return false;
    }

    flightRecorder.info('Wenxin', 'INPUT_FOUND', { tag: input.tagName });

    const injected = await simulateTextInput(input, prompt);
    if (!injected) {
      flightRecorder.error('Wenxin', 'PROMPT_INJECT_FAILED');
      return false;
    }
    flightRecorder.info('Wenxin', 'PROMPT_INJECT_SUCCESS', { promptLen: prompt.length });

    await this.sleep(350);

    const sendBtn = this.findSendButton();
    const isAriaDisabled = sendBtn?.getAttribute('aria-disabled') === 'true';
    const hasDisabledClass = sendBtn?.classList.contains('disabled') || sendBtn?.classList.contains('is-disabled');
    const isDisabled = sendBtn?.hasAttribute('disabled') || isAriaDisabled || hasDisabledClass;
    if (sendBtn && !isDisabled) {
      sendBtn.click();
      sendBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      sendBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      flightRecorder.info('Wenxin', 'SEND_BUTTON_CLICKED');
      await this.sleep(200);
    } else {
      flightRecorder.warn('Wenxin', 'SEND_BUTTON_DISABLED_OR_NOT_FOUND', { exists: !!sendBtn, isDisabled });
    }

    const form = input.closest('form');
    if (form && !this.findStopButton()) {
      try {
        form.requestSubmit();
        flightRecorder.info('Wenxin', 'FORM_REQUEST_SUBMIT_CALLED');
        await this.sleep(200);
      } catch {}
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
      flightRecorder.info('Wenxin', 'ENTER_KEY_DISPATCHED');
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
      document.querySelector<HTMLElement>('main, div[class*="chat-wrap"], div[class*="dialogue"], div[class*="chat-body"], div[class*="chatBody"]') ||
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

        // 思考中过滤：若剥离思考后长度为 0，返回空以保持监听
        const { cleaned } = stripThinkBlocks(result);
        if (cleaned.length === 0) {
          return '';
        }

        // 核心防断崖式回退保护（Anti-Shrink Protection）：
        // 若当前轮次已抓取了长正文（例如 1500+ 字），而当前帧因底部挂件、弹窗或临时节点漂移骤降为极短文本（如 2 字“表格”），
        // 绝不采纳此脏快照，坚决返回历史最高有效长文本，彻底根除 1550 字突变为 2 字的早熟误判缺陷！
        if (this.currentSnapshot.length > 100 && result.length < this.currentSnapshot.length * 0.3) {
          return this.currentSnapshot;
        }

        if (result.length >= this.currentSnapshot.length) {
          this.currentSnapshot = result;
        }
        return this.currentSnapshot || result;
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
      document.querySelector<HTMLElement>('div[contenteditable="true"]') ||
      document.querySelector<HTMLElement>('textarea[class*="input"]') ||
      document.querySelector<HTMLElement>('#contenteditable') ||
      document.querySelector<HTMLElement>('textarea') ||
      document.querySelector<HTMLElement>('div.chat-input')
    );
  }

  private findSendButton(): HTMLElement | null {
    const direct = document.querySelector<HTMLElement>(
      'span[class*="sendBtn"], div[class*="sendBtn"], span[class*="send_btn"], div[class*="send_btn"], div[class*="send-btn"], span[class*="send-btn"], button[class*="send"], div[class*="enter-btn"], span[class*="submit"], div[class*="submit"], div[role="button"][aria-label*="发送"], button[aria-label*="发送"], div[class*="operate-btn"]'
    );
    if (direct) return direct;

    const input = this.findInputElement();
    let parent = input?.parentElement;
    for (let i = 0; i < 6 && parent; i++) {
      const candidates = Array.from(parent.querySelectorAll<HTMLElement>('div[role="button"], span[role="button"], button'));
      const candidate = candidates.reverse().find((b) => {
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const cls = (b.className || '').toLowerCase();
        if (aria.includes('file') || aria.includes('upload') || aria.includes('plugin') || cls.includes('upload')) {
          return false;
        }
        return b.querySelector('svg') !== null || cls.includes('send') || cls.includes('submit') || cls.includes('enter');
      });
      if (candidate) return candidate;
      parent = parent.parentElement;
    }
    return null;
  }

  private findStopButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('span[class*="stop"]') ||
      document.querySelector<HTMLElement>('button[class*="stop"]') ||
      document.querySelector<HTMLElement>('div[class*="stop"]') ||
      document.querySelector<HTMLElement>('div[class*="stop-btn"]') ||
      document.querySelector<HTMLElement>('div[class*="stopBtn"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="停止"]') ||
      document.querySelector<HTMLElement>('div[role="button"][aria-label*="停止"]') ||
      document.querySelector<HTMLElement>('span[aria-label*="停止"]')
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
    // 1. 查找所有可能的机器人轮次外层卡片（广泛兼容历代文心一言与当前现代版本）
    const turnSelectors = [
      'div[class*="messageListItem"]',
      'div[class*="message-item"]',
      'div[class*="messageItem"]',
      'div[class*="chat-item"]',
      'div[class*="chatItem"]',
      'div[class*="dialogue-item"]',
      'div[class*="chat-message"]',
      'div[class*="ans-item"]',
      'div[class*="answer-item"]',
      'div[class*="answerItem"]',
      'div[class*="robot-item"]',
      'div[class*="robot_item"]',
      'div[class*="robotItem"]',
      'div[class*="assistant"]',
      'div[class*="bot-message"]',
      'div[data-role="assistant"]',
      'div[data-is-user="false"]',
    ];

    const turns = Array.from(document.querySelectorAll<HTMLElement>(turnSelectors.join(', '))).filter((el) => {
      const cls = (el.className || '').toString().toLowerCase();
      const role = (el.getAttribute('data-role') || '').toLowerCase();
      const isUser =
        cls.includes('user') ||
        cls.includes('human') ||
        cls.includes('self') ||
        cls.includes('right') ||
        role === 'user' ||
        el.getAttribute('data-is-user') === 'true';
      const isInput = cls.includes('input') || cls.includes('fixed') || cls.includes('editor') || cls.includes('textarea');
      return !isUser && !isInput;
    });

    if (turns.length > 0) {
      // 倒序遍历轮次，严格排除底部独立的插件卡片、表格浮层或操作栏
      for (let i = turns.length - 1; i >= 0; i--) {
        const turn = turns[i]!;
        const cls = (turn.className || '').toLowerCase();
        if (
          cls.includes('action') ||
          cls.includes('plugin') ||
          cls.includes('toolbar') ||
          cls.includes('tool-bar') ||
          cls.includes('footer') ||
          cls.includes('operate')
        ) {
          continue;
        }
        const contentEl = turn.querySelector<HTMLElement>(
          'div[class*="eb-markdown"], div[class*="robot-content"], div[class*="md-view"], div[class*="markdown"], div[class*="rich-text"], div[class*="richText"], div[class*="textContent"], div[class*="text-content"], div[class*="answer-content"], div.markdown-body'
        );
        const text = ((contentEl || turn).innerText || (contentEl || turn).textContent || '').trim();
        // 若该轮次有实质正文 (> 20字)，优先采纳
        if (text.length > 20) {
          return contentEl || turn;
        }
      }
      return turns[turns.length - 1]!;
    }

    // 2. 降级：查询页面中所有非用户的 markdown / 富文本正文容器
    const mdList = Array.from(
      document.querySelectorAll<HTMLElement>(
        'div[class*="eb-markdown"], div[class*="robot-content"], div[class*="markdown-body"], div[class*="markdown"], div[class*="rich-text"], div[class*="richText"]'
      )
    ).filter((el) => {
      const cls = (el.className || '').toLowerCase();
      const parentCls = (el.parentElement?.className || '').toLowerCase();
      const isInput = cls.includes('input') || cls.includes('editor') || parentCls.includes('input') || parentCls.includes('editor');
      const isUser = cls.includes('user') || parentCls.includes('user');
      return !isInput && !isUser;
    });

    if (mdList.length > 0) {
      return mdList[mdList.length - 1] ?? null;
    }

    // 3. 降级：通过助手专属工具栏（如“复制回答”、“重新生成”等按钮）定位父级回答容器
    const toolButtons = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button[aria-label*="复制"], div[aria-label*="复制"], span[aria-label*="复制"], div[class*="copy"], button[class*="copy"], div[class*="action"], div[class*="feedback"]'
      )
    );
    for (let i = toolButtons.length - 1; i >= 0; i--) {
      const btn = toolButtons[i]!;
      const parentMsg = btn.closest<HTMLElement>(
        'div[class*="item"], div[class*="message"], div[class*="dialogue"], div[class*="content"]'
      );
      if (parentMsg) {
        return parentMsg;
      }
    }

    // 4. 降级：寻找聊天区域内的所有非用户段落组合
    const allBubbles = Array.from(
      document.querySelectorAll<HTMLElement>(
        'main div[class*="content"], div[class*="chat"] div[class*="content"], div[class*="dialogue"] div[class*="content"], div[role="log"] div[class*="content"]'
      )
    ).filter((b) => {
      const cls = (b.className || '').toLowerCase();
      return !cls.includes('user') && !cls.includes('self') && !cls.includes('human') && !cls.includes('input');
    });

    if (allBubbles.length > 0) {
      return allBubbles[allBubbles.length - 1] ?? null;
    }

    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

export const wenxinAdapter = new WenxinAdapter();
adapterRegistry.register(wenxinAdapter);
