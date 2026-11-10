import type { AISiteAdapter } from './base';
import { adapterRegistry } from './base';
import type { SupportedSite } from '../types/review-job';
import { simulateTextInput } from '../utils/insert-text';
import { stripThinkBlocks } from '../utils/think-block-strip';
import { domToMarkdown } from '../utils/dom-to-markdown';
import { QuadSignalDoneDetector } from '../utils/done-detector';
import { isLoginButtonPresent } from '../utils/dom-checker';
import { flightRecorder } from '../logger/flight-recorder';

function isWenxinUserTurnElement(el: HTMLElement): boolean {
  if (
    el.getAttribute('data-role') === 'user' ||
    el.getAttribute('data-is-user') === 'true' ||
    el.getAttribute('data-message-author-role') === 'user'
  ) {
    return true;
  }
  const cls = (el.className || '').toString().toLowerCase();
  // 必须严格排除 CSS 禁选属性如 user-select-none，杜绝代码块被误判为用户提问
  if (cls.includes('user-select') || cls.includes('userselect')) {
    return false;
  }
  return (
    cls.includes('user-message') ||
    cls.includes('message-user') ||
    cls.includes('chat-item-user') ||
    cls.includes('dialogue-user') ||
    cls.includes('item-user') ||
    cls.includes('robot-item-user')
  );
}

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
        const lastUserEl = this.findLatestUserMessageElement();
        let candidateContainers: HTMLElement[] = [];

        // 1. 若定位到了用户最后一条输入，获取在其后生成的所有 markdown / robot-content 容器（彻底防止多卡片被截断）
        if (lastUserEl) {
          const allMd = Array.from(
            document.querySelectorAll<HTMLElement>(
              'div[class*="eb-markdown"], div[class*="robot-content"], div[class*="md-view"], div[class*="markdown"], div[class*="rich-text"], div[class*="richText"], div[class*="textContent"], div[class*="text-content"], div[class*="answer-content"], div.markdown-body'
            )
          ).filter((el) => {
            let parent = el.parentElement;
            while (parent && parent !== document.body) {
              if (isWenxinUserTurnElement(parent)) return false;
              parent = parent.parentElement;
            }
            if (isWenxinUserTurnElement(el)) return false;
            return (lastUserEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
          });

          candidateContainers = allMd.filter((el) => {
            return !el.parentElement?.closest(
              'div[class*="eb-markdown"], div[class*="robot-content"], div[class*="md-view"], div[class*="markdown"], div[class*="rich-text"], div[class*="richText"], div[class*="textContent"], div[class*="text-content"], div[class*="answer-content"], div.markdown-body'
            );
          });
        }

        let result = '';
        if (candidateContainers.length > 0) {
          result = candidateContainers
            .map((el) => {
              const clone = el.cloneNode(true) as HTMLElement;
              clone
                .querySelectorAll(
                  'div[class*="toolbar"], div[class*="tool-bar"], div[class*="footer"], div[class*="operate"], div[class*="action"], [role="toolbar"], button, div[class*="avatar"]'
                )
                .forEach((node) => node.remove());
              const md = domToMarkdown(clone);
              return (md && md.trim().length > 0) ? md : (clone.innerText || clone.textContent || '').trim();
            })
            .filter((t) => t.trim().length > 0)
            .join('\n\n');
        }

        // 2. 兜底与整轮合并：结合 findLatestAssistantMessageElement()
        const lastMsgEl = this.findLatestAssistantMessageElement();
        if (lastMsgEl) {
          // 主动滚屏保持元素挂载，防止文心一言虚拟滚动卸载上部段落
          try {
            lastMsgEl.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'end' });
          } catch {}

          const currentText = (lastMsgEl.innerText || lastMsgEl.textContent || '').trim();
          if (lastMsgEl === this.baselineLastElement) {
            if (currentText.length <= this.baselineLastContent.length && !result) {
              return '';
            }
          }

          const clone = lastMsgEl.cloneNode(true) as HTMLElement;
          clone
            .querySelectorAll(
              'div[class*="toolbar"], div[class*="tool-bar"], div[class*="footer"], div[class*="operate"], div[class*="action"], [role="toolbar"], button, div[class*="avatar"]'
            )
            .forEach((el) => el.remove());

          if (!result) {
            const mdContainers = Array.from(
              clone.querySelectorAll<HTMLElement>(
                'div[class*="eb-markdown"], div[class*="robot-content"], div[class*="md-view"], div[class*="markdown"], div[class*="rich-text"], div[class*="richText"], div[class*="textContent"], div[class*="text-content"], div[class*="answer-content"], div.markdown-body'
              )
            ).filter((el) => {
              return !el.parentElement?.closest(
                'div[class*="eb-markdown"], div[class*="robot-content"], div[class*="md-view"], div[class*="markdown"], div[class*="rich-text"], div[class*="richText"], div[class*="textContent"], div[class*="text-content"], div[class*="answer-content"], div.markdown-body'
              );
            });

            if (mdContainers.length > 0) {
              result = mdContainers
                .map((el) => {
                  const md = domToMarkdown(el);
                  return (md && md.trim().length > 0) ? md : (el.innerText || el.textContent || '').trim();
                })
                .filter((t) => t.trim().length > 0)
                .join('\n\n');
            }
          }

          // 核心：对净化后的整轮执行转换，若全轮文本长度大于子块聚合，采用全轮
          const fullMd = domToMarkdown(clone);
          const fullText = (fullMd && fullMd.trim().length > 0) ? fullMd : (clone.innerText || clone.textContent || '').trim();
          if (fullText.length > result.length) {
            result = fullText;
          }
        }

        // 思考中过滤：若剥离思考后长度为 0，返回空以保持监听
        const { cleaned } = stripThinkBlocks(result);
        if (cleaned.length === 0) {
          return '';
        }

        // 核心防断崖式回退保护（Anti-Shrink Protection）：
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

  private findInputElement(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('div[contenteditable="true"]') ||
      document.querySelector<HTMLElement>('textarea[class*="input"]') ||
      document.querySelector<HTMLElement>('#contenteditable') ||
      document.querySelector<HTMLElement>('textarea') ||
      document.querySelector<HTMLElement>('div.chat-input')
    );
  }

  private isStopActionElement(el: HTMLElement | null): boolean {
    if (!el) return false;
    const aria = (el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
    if (aria.includes('停止') || aria.includes('stop') || aria.includes('pause') || aria.includes('取消生成') || aria.includes('停止响应')) {
      return true;
    }
    const cls = (el.className || '').toString().toLowerCase();
    if (cls.includes('stop') || cls.includes('pause') || cls.includes('loading')) {
      return true;
    }
    // 检查是否包含方形停止图标（如 <rect> 或含 stop 特征的 SVG）
    if (el.querySelector('rect, [class*="stop"], [class*="pause"], [class*="square"]')) {
      return true;
    }
    return false;
  }

  private findSendButton(): HTMLElement | null {
    const input = this.findInputElement();
    const container = input ? (input.closest('div[class*="input"], div[class*="chat-input"], div[class*="chat_input"], div[class*="sender"], form') as HTMLElement | null) : null;
    const searchRoot = container || document;

    const candidates = Array.from(
      searchRoot.querySelectorAll<HTMLElement>(
        'span[class*="sendBtn"], div[class*="sendBtn"], span[class*="send_btn"], div[class*="send_btn"], div[class*="send-btn"], span[class*="send-btn"], button[class*="send"], div[class*="enter-btn"], span[class*="submit"], div[class*="submit"], div[role="button"][aria-label*="发送"], button[aria-label*="发送"], div[class*="operate-btn"]'
      )
    );

    // 严厉排除处于停止态（包含 rect、stop 语义）的按钮
    const sendBtn = candidates.find((b) => {
      if (this.isStopActionElement(b)) return false;
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      if (aria.includes('file') || aria.includes('upload') || aria.includes('plugin') || aria.includes('image')) {
        return false;
      }
      return true;
    });

    if (sendBtn) return sendBtn;

    let parent = input?.parentElement;
    for (let i = 0; i < 6 && parent; i++) {
      const parentCandidates = Array.from(parent.querySelectorAll<HTMLElement>('div[role="button"], span[role="button"], button'));
      const candidate = parentCandidates.reverse().find((b) => {
        if (this.isStopActionElement(b)) return false;
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
    const input = this.findInputElement();
    const container = input ? (input.closest('div[class*="input"], div[class*="chat-input"], div[class*="chat_input"], div[class*="sender"], form') as HTMLElement | null) : null;
    const searchRoot = container || document;

    // 1. 输入框容器内部查找 stop 元素
    const candidates = Array.from(searchRoot.querySelectorAll<HTMLElement>('div[role="button"], span[role="button"], button, span, div'));
    const found = candidates.find((b) => this.isStopActionElement(b));
    if (found) return found;

    // 2. 全局选择器兜底
    return (
      searchRoot.querySelector<HTMLElement>('span[class*="stop"], button[class*="stop"], div[class*="stop"], div[class*="stop-btn"], div[class*="stopBtn"], button[aria-label*="停止"], div[role="button"][aria-label*="停止"], span[aria-label*="停止"]') ||
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

  private findLatestUserMessageElement(): HTMLElement | null {
    const userNodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        'div[class*="chat-message"], div[class*="ans-item"], div[class*="robot-item"], div[class*="dialogue"], div[class*="item"], div[class*="message"], [data-role="user"]'
      )
    ).filter((el) => {
      const cls = (el.className || '').toString().toLowerCase();
      const isInput = cls.includes('input') || cls.includes('editor') || cls.includes('fixed') || cls.includes('textarea');
      return !isInput && isWenxinUserTurnElement(el);
    });
    return userNodes.length > 0 ? userNodes[userNodes.length - 1]! : null;
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
      const isInput = cls.includes('input') || cls.includes('fixed') || cls.includes('editor') || cls.includes('textarea');
      return !isWenxinUserTurnElement(el) && !isInput;
    });

    if (turns.length > 0) {
      // 过滤掉嵌套在同类候选内部的子卡片，保证获取到的是最外层的完整轮次
      const topLevelTurns = turns.filter((el) => {
        return !el.parentElement?.closest(turnSelectors.join(', '));
      });
      const validTurns = topLevelTurns.length > 0 ? topLevelTurns : turns;

      // 倒序遍历轮次，严格排除底部独立的插件卡片、表格浮层或操作栏
      for (let i = validTurns.length - 1; i >= 0; i--) {
        const turn = validTurns[i]!;
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
        // 核心修正：直接返回完整轮次容器 turn，由上层净化并聚合所有 markdown/文本子块，彻底杜绝单块 ISS-01 截断！
        return turn;
      }
      return validTurns[validTurns.length - 1]!;
    }

    // 2. 降级：查询页面中所有非用户的 markdown / 富文本正文容器
    const mdList = Array.from(
      document.querySelectorAll<HTMLElement>(
        'div[class*="eb-markdown"], div[class*="robot-content"], div[class*="markdown-body"], div[class*="markdown"], div[class*="rich-text"], div[class*="richText"]'
      )
    ).filter((el) => {
      let parent = el.parentElement;
      while (parent && parent !== document.body) {
        if (isWenxinUserTurnElement(parent)) return false;
        parent = parent.parentElement;
      }
      return !isWenxinUserTurnElement(el);
    });

    if (mdList.length > 0) {
      const lastMd = mdList[mdList.length - 1]!;
      const parentMsg = lastMd.closest<HTMLElement>(
        'div[class*="item"], div[class*="message"], div[class*="dialogue"], div[class*="content"]'
      );
      if (parentMsg && !isWenxinUserTurnElement(parentMsg)) {
        return parentMsg;
      }
      return lastMd;
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
      if (parentMsg && !isWenxinUserTurnElement(parentMsg)) {
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
      return !isWenxinUserTurnElement(b) && !cls.includes('input');
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
