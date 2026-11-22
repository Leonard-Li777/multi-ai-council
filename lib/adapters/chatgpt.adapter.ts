import type { AISiteAdapter } from './base';
import { adapterRegistry } from './base';
import type { SupportedSite } from '../types/review-job';
import { simulateTextInput } from '../utils/insert-text';
import { stripThinkBlocks } from '../utils/think-block-strip';
import { domToMarkdown } from '../utils/dom-to-markdown';
import { QuadSignalDoneDetector } from '../utils/done-detector';
import { isLoginButtonPresent } from '../utils/dom-checker';
import { flightRecorder } from '../logger/flight-recorder';

export class ChatGPTAdapter implements AISiteAdapter {
  public readonly siteName: SupportedSite = 'ChatGPT';
  public readonly urlPattern = /^https:\/\/chatgpt\.com(\/.*)?$/;
  public readonly adapterVersion = '1.0.0';

  private activeDetector: QuadSignalDoneDetector | null = null;
  private currentSnapshot = '';
  private baselineLastElement: HTMLElement | null = null;
  private baselineLastContent = '';
  private baselineArticleCount = 0;
  private lastPromptLength = 0;
  private didClickSend = false;
  private highWaterMarkSnapshot = '';

  public recordBaseline(): void {
    const el = this.findLatestAssistantMessageElement();
    this.baselineLastElement = el;
    this.baselineLastContent = el ? (domToMarkdown(el) || el.innerText || el.textContent || '').trim() : '';
    this.baselineArticleCount = document.querySelectorAll('article').length;
    this.highWaterMarkSnapshot = '';
  }

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
    // 1. 若输入框已存在，说明处于聊天状态，绝非未登录
    const input = this.findInputElement();
    if (input) {
      const captcha = document.querySelector(
        'iframe[src*="challenges.cloudflare.com"], #challenge-running, div[class*="turnstile"], div[id*="cf-challenge"]'
      );
      if (captcha) return 'CAPTCHA';
      return 'OK';
    }

    // 2. Cloudflare 质询 / Turnstile
    const captcha = document.querySelector(
      'iframe[src*="challenges.cloudflare.com"], #challenge-running, div[class*="turnstile"], div[id*="cf-challenge"]'
    );
    if (captcha) return 'CAPTCHA';

    // 3. 未登录检查（特定 URL 或登录按钮）
    if (
      window.location.pathname.includes('/auth') ||
      window.location.pathname.includes('/login') ||
      isLoginButtonPresent('button[data-testid="login-button"], a[href*="/auth/login"], button, a')
    ) {
      return 'NOT_LOGGED_IN';
    }

    // 4. 限流 / 异常提示检查
    const errorBanner = document.querySelector(
      'div[class*="text-token-text-error"], div[data-testid*="error"]'
    );
    if (errorBanner) {
      const errorText = errorBanner.textContent?.toLowerCase() || '';
      if (errorText.includes('rate limit') || errorText.includes('too many requests') || errorText.includes('capacity')) {
        return 'RATE_LIMIT';
      }
    }

    return 'DOM_CHANGED';
  }

  /**
   * 检查页面当前是否已存在历史消息
   */
  public hasExistingMessages(): boolean {
    const msgs = document.querySelectorAll(
      'article, div[data-message-author-role="assistant"], div[class*="agent-turn"]'
    );
    return msgs.length > 0;
  }

  /**
   * 开启新会话
   */
  public async createNewChat(force = false): Promise<void> {
    // 若当前已经是根路径且非强制唤醒，本身即为全新会话，无需触发导航
    if (!force && (window.location.pathname === '/' || window.location.pathname === '')) {
      return;
    }

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
      const testid = (el.getAttribute('data-testid') || '').toLowerCase();
      return (
        testid.includes('create-new-chat') ||
        testid.includes('new-chat') ||
        text === 'new chat' ||
        text === '新聊天' ||
        text === '新对话' ||
        aria.includes('new chat') ||
        aria.includes('新聊天') ||
        aria.includes('新对话')
      );
    });

    if (newChatBtn) {
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
   * 注入提示词并点击发送（攻坚 ProseMirror 受控组件与剪贴板模拟）
   */
  public async sendPrompt(prompt: string): Promise<boolean> {
    this.recordBaseline();

    // 1. 轮询等待真实可交互输入框就绪 (最多等待 15 秒)
    // 严禁将 SSR 阶段的 #pending-home-input 占位符当作最终就绪输入框
    let input: HTMLElement | null = null;
    for (let i = 0; i < 75; i++) {
      const el = this.findInputElement();
      if (el && el.isConnected) {
        input = el;
        break;
      }

      // 若命中了 ChatGPT 首页的 pending 占位 textarea，主动点击唤醒真实 ProseMirror 挂载
      const pending = document.querySelector<HTMLElement>('#pending-home-input, textarea[data-id="root"]');
      if (pending) {
        pending.focus();
        pending.click();
        pending.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        pending.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        pending.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }

      // 每隔 2 秒尝试触发一次创建新会话以强制唤醒聊天主视窗
      if (i > 0 && i % 10 === 0) {
        await this.createNewChat(true);
      }

      await this.sleep(200);
    }

    if (!input) {
      flightRecorder.error('ChatGPT', 'INPUT_NOT_FOUND_AFTER_POLLING');
      console.error('[ChatGPTAdapter] Input element not found after polling');
      return false;
    }

    flightRecorder.info('ChatGPT', 'INPUT_FOUND', { tag: input.tagName, id: input.id });
    this.lastPromptLength = prompt.length;
    this.didClickSend = false;

    // 2. 模拟写入 ProseMirror 富文本或标准 textarea
    input.click();
    input.focus();
    let injected = false;
    try {
      injected = await simulateTextInput(input, prompt);
    } catch {}

    // 辅助函数：读取输入框当前文本
    const readInputText = (el: HTMLElement): string =>
      el instanceof HTMLTextAreaElement ? el.value : (el.innerText || el.textContent || '');

    // 若模拟写入未生效或为空，根据元素类型分别执行严格注入保底
    let currentVal = readInputText(input);
    if (!injected || currentVal.trim().length === 0) {
      if (input instanceof HTMLTextAreaElement) {
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (valueSetter) {
          valueSetter.call(input, prompt);
        } else {
          input.value = prompt;
        }
        input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: prompt }));
        input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: prompt }));
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      } else {
        // 先尝试触发 ProseMirror 原生 paste 通道（对超长文本与后台标签页最可靠）
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', prompt);
          input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true, clipboardData: dt }));
          input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        } catch {}

        currentVal = readInputText(input);
        if (currentVal.trim().length === 0) {
          let p = input.querySelector('p');
          if (!p) {
            p = document.createElement('p');
            input.innerHTML = '';
            input.appendChild(p);
          }
          p.textContent = prompt;
          input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: prompt }));
          input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: prompt }));
          input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, composed: true, data: prompt }));
          input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        }
      }
      injected = true;
      flightRecorder.info('ChatGPT', 'PROMPT_INJECT_FALLBACK_TREE', {
        promptLength: prompt.length,
        actualLength: readInputText(input).trim().length,
      });
    } else {
      flightRecorder.info('ChatGPT', 'PROMPT_INJECT_SUCCESS', {
        promptLength: prompt.length,
        actualLength: currentVal.trim().length,
      });
    }

    await this.sleep(350);

    // 3. 轮询等待 React/ProseMirror 渲染并解禁真正的发送按钮 (最多 3 秒)
    // 严禁在发送按钮未出现时误点右下角的语音输入/听写按钮！
    let submitted = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      await this.sleep(200);

      // 若已经出现真正的停止按钮，说明已成功进入生成
      if (this.findStopButton()) {
        submitted = true;
        flightRecorder.info('ChatGPT', 'STOP_BUTTON_ALREADY_PRESENT');
        break;
      }

      const sendBtn = this.findSendButton();
      if (sendBtn) {
        const isAriaDisabled = sendBtn.getAttribute('aria-disabled') === 'true';
        const isDisabled = sendBtn.hasAttribute('disabled') || isAriaDisabled;
        if (!isDisabled) {
          sendBtn.click();
          submitted = true;
          this.didClickSend = true;
          flightRecorder.info('ChatGPT', 'SEND_BUTTON_CLICKED', {
            attempt,
            testid: sendBtn.getAttribute('data-testid') || '',
            aria: sendBtn.getAttribute('aria-label') || '',
          });
          await this.sleep(800);
          break;
        } else if (attempt >= 8) {
          // 仅对明确识别的发送按钮在 1.6s 后仍 disabled 时解除限制并点击
          sendBtn.removeAttribute('disabled');
          sendBtn.setAttribute('aria-disabled', 'false');
          sendBtn.click();
          submitted = true;
          this.didClickSend = true;
          flightRecorder.warn('ChatGPT', 'SEND_BUTTON_FORCE_CLICKED', { attempt });
          await this.sleep(800);
          break;
        }
      } else if (attempt === 4 || attempt === 9) {
        // 若仍未渲染出真正的发送按钮（可能 ProseMirror 未同步 React 状态），补发 input 事件唤醒
        input.focus();
        input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: '' }));
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      }
    }

    // 4. 单通道互斥保底：仅在未成功点击发送按钮且未检测到停止按钮时，才尝试派发单次 Enter 键盘事件！
    // 坚决杜绝 form.requestSubmit() 与多次并发派发 Enter，彻底解决 Next.js/ProseMirror 并发踩踏卡死页面！
    if (!submitted && !this.findStopButton()) {
      input.focus();
      const enterInit: KeyboardEventInit = {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true,
      };
      input.dispatchEvent(new KeyboardEvent('keydown', enterInit));
      input.dispatchEvent(new KeyboardEvent('keypress', enterInit));
      input.dispatchEvent(new KeyboardEvent('keyup', enterInit));
      flightRecorder.info('ChatGPT', 'ENTER_KEY_DISPATCHED');
      await this.sleep(500);
    }

    return true;
  }

  /**
   * 验证消息是否提交成功
   */
  public async validateSubmission(): Promise<boolean> {
    const isInputClearedOrShrunk = (el: HTMLElement): boolean => {
      const val = (el instanceof HTMLTextAreaElement ? el.value : (el.innerText || el.textContent || '')).trim();
      if (val.length === 0) return true;
      // 针对超长提示词（如 49,000 字）被 ProseMirror 折叠为附件胶囊或已清空但留有占位符的场景
      if (this.lastPromptLength > 200 && val.length < Math.min(80, this.lastPromptLength * 0.1)) {
        return true;
      }
      return false;
    };

    for (let i = 0; i < 15; i++) {
      await this.sleep(400);
      const stopBtn = this.findStopButton();
      if (stopBtn) {
        flightRecorder.info('ChatGPT', 'VALIDATE_SUBMISSION_PASS', { reason: 'STOP_BUTTON_DETECTED' });
        return true;
      }

      // 检查是否已经产生新的消息 article（包含用户提问卡片上屏）
      if (document.querySelectorAll('article').length > this.baselineArticleCount) {
        flightRecorder.info('ChatGPT', 'VALIDATE_SUBMISSION_PASS', { reason: 'NEW_ARTICLE_RENDERED' });
        return true;
      }

      // 检查是否已经产生新的回答容器
      const lastMsg = this.findLatestAssistantMessageElement();
      if (lastMsg && lastMsg !== this.baselineLastElement) {
        flightRecorder.info('ChatGPT', 'VALIDATE_SUBMISSION_PASS', { reason: 'NEW_ASSISTANT_MESSAGE_DETECTED' });
        return true;
      }

      // 检查 URL 是否发生改变（例如从 / 变为 /c/<uuid>）
      if (window.location.pathname.startsWith('/c/')) {
        flightRecorder.info('ChatGPT', 'VALIDATE_SUBMISSION_PASS', { reason: 'CONVERSATION_URL_CREATED' });
        return true;
      }

      const input = this.findInputElement();
      if (input && i >= 2 && isInputClearedOrShrunk(input)) {
        flightRecorder.info('ChatGPT', 'VALIDATE_SUBMISSION_PASS', { reason: 'INPUT_CLEARED' });
        return true;
      }
    }

    // 最终检查：若依然有 stop 按钮、新 article 或新回答容器则判定成功
    if (this.findStopButton()) {
      flightRecorder.info('ChatGPT', 'VALIDATE_SUBMISSION_PASS', { reason: 'FINAL_STOP_BUTTON_DETECTED' });
      return true;
    }

    if (document.querySelectorAll('article').length > this.baselineArticleCount) {
      flightRecorder.info('ChatGPT', 'VALIDATE_SUBMISSION_PASS', { reason: 'FINAL_NEW_ARTICLE_RENDERED' });
      return true;
    }

    const finalLastMsg = this.findLatestAssistantMessageElement();
    if (finalLastMsg && finalLastMsg !== this.baselineLastElement) {
      flightRecorder.info('ChatGPT', 'VALIDATE_SUBMISSION_PASS', { reason: 'FINAL_NEW_ASSISTANT_MESSAGE_DETECTED' });
      return true;
    }

    // 若输入框已被清空或大幅缩减也判定成功
    const finalInput = this.findInputElement();
    if (finalInput && isInputClearedOrShrunk(finalInput)) {
      flightRecorder.info('ChatGPT', 'VALIDATE_SUBMISSION_PASS', { reason: 'FINAL_INPUT_CLEARED' });
      return true;
    }

    // 唯一单次温和补发兜底：仅在经过整整 6 秒无响应且依然处于未发送时尝试单次 Enter，严禁循环内频繁轰炸
    if (finalInput) {
      flightRecorder.warn('ChatGPT', 'VALIDATE_SUBMISSION_RETRY_ENTER_ONCE');
      finalInput.focus();
      const eventInit: KeyboardEventInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
      finalInput.dispatchEvent(new KeyboardEvent('keydown', eventInit));
      finalInput.dispatchEvent(new KeyboardEvent('keypress', eventInit));
      finalInput.dispatchEvent(new KeyboardEvent('keyup', eventInit));
      await this.sleep(1000);
      if (
        this.findStopButton() ||
        window.location.pathname.startsWith('/c/') ||
        document.querySelectorAll('article').length > this.baselineArticleCount ||
        isInputClearedOrShrunk(finalInput)
      ) {
        return true;
      }
    }

    // Fail-Open 防误杀：如果此前已明确点击发送按钮（SEND_BUTTON_CLICKED），绝不因后台标签页定时器节流或超长提示词渲染延迟而放弃挂载监听器！
    if (this.didClickSend) {
      flightRecorder.warn('ChatGPT', 'VALIDATE_SUBMISSION_FAIL_OPEN', {
        reason: 'SEND_CLICKED_PROCEED_TO_LISTEN',
        promptLength: this.lastPromptLength,
      });
      return true;
    }

    flightRecorder.warn('ChatGPT', 'VALIDATE_SUBMISSION_FAIL', { reason: 'PROMPT_STILL_IN_INPUT_NO_STOP' });
    console.warn('[ChatGPTAdapter] Validation failed: Prompt still in input and no stop button');
    return false;
  }

  /**
   * 启动流式生成监听
   */
  public listenGeneration(
    onUpdate: (snapshot: string, cleaned: string) => void,
    onDone: (finalCleaned: string) => void,
    options?: { allowShortReply?: boolean; silenceThresholdMs?: number }
  ): () => void {
    const chatContainer =
      document.querySelector<HTMLElement>('main, div[class*="react-scroll-to-bottom"], div[role="presentation"]') ||
      document.body;

    this.activeDetector = new QuadSignalDoneDetector({
      getStopButton: () => this.findStopButton(),
      getSendButton: () => this.findSendButton(),
      getCurrentContent: () => {
        const lastMsgEl = this.findLatestAssistantMessageElement();
        if (!lastMsgEl) return this.highWaterMarkSnapshot;

        if (lastMsgEl === this.baselineLastElement) {
          const currentText = (lastMsgEl.innerText || lastMsgEl.textContent || '').trim();
          if (currentText === this.baselineLastContent) {
            return '';
          }
        }

        const result = this.extractFormalMarkdownFromTurn(lastMsgEl);

        // Anti-Shrink 高水位单调保护：彻底杜绝 ChatGPT 尾部渲染图表/卡片/虚拟化重排时，
        // 将已捕获的长报告覆盖成短文本！
        if (this.highWaterMarkSnapshot.length >= 200 && result.length < this.highWaterMarkSnapshot.length * 0.75) {
          return this.highWaterMarkSnapshot;
        }
        if (result.length > this.highWaterMarkSnapshot.length) {
          this.highWaterMarkSnapshot = result;
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
      silenceThresholdMs: options?.silenceThresholdMs ?? 12000,
      allowShortReply: options?.allowShortReply,
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

  public dismissDialogs(): boolean {
    // 自动检测并关闭诸如 "Your account was switched"、"Stay logged out"、"Something went wrong" 等异常弹窗
    const dialogButtons = Array.from(
      document.querySelectorAll<HTMLElement>(
        'div[role="dialog"] button, div[role="alertdialog"] button, div[class*="modal"] button, div[data-state="open"] button'
      )
    );
    let dismissed = false;
    for (const btn of dialogButtons) {
      const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
      if (
        text.includes('stay logged out') ||
        text.includes('dismiss') ||
        text.includes('ok') ||
        text.includes('reload') ||
        text.includes('try again') ||
        text.includes('确定') ||
        text.includes('知道了') ||
        text.includes('重试') ||
        text.includes('关闭') ||
        btn.getAttribute('aria-label') === 'Close'
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
    // 步骤 1：关闭账户切换或报错遮罩弹窗
    this.dismissDialogs();
    await this.sleep(300);

    // 步骤 2：检查是否已经产出了回答
    const lastMsg = this.findLatestAssistantMessageElement();
    const currentText = lastMsg ? (lastMsg.innerText || lastMsg.textContent || '').trim() : '';
    if (lastMsg && lastMsg !== this.baselineLastElement && currentText.length > 15 && !this.findStopButton()) {
      const md = domToMarkdown(lastMsg);
      const cleaned = (md && md.trim().length > 0) ? md : currentText;
      onDone(cleaned);
      return 'DONE';
    }

    // 步骤 3：检查是否正在流式生成中
    if (this.findStopButton()) {
      this.listenGeneration(onUpdate, onDone);
      return 'STREAMING';
    }

    // 步骤 4：检查输入框是否已经含有提示词内容
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

    // 步骤 5：输入框为空，重新执行完整注入与提交
    const sent = await this.sendPrompt(prompt);
    if (sent) {
      this.listenGeneration(onUpdate, onDone);
      return 'STREAMING';
    }

    return 'FAILED';
  }

  public findInputElement(): HTMLElement | null {
    // 1. 优先匹配正式的聊天输入框 #prompt-textarea
    const promptTextarea = document.querySelector<HTMLElement>(
      '#prompt-textarea, div[contenteditable="true"]#prompt-textarea, textarea#prompt-textarea'
    );
    if (promptTextarea) return promptTextarea;

    // 2. 匹配通用 contenteditable 富文本输入框 (ProseMirror)
    const contentEditable = document.querySelector<HTMLElement>(
      'div[contenteditable="true"][data-placeholder], div[contenteditable="true"].ProseMirror, div[contenteditable="true"]'
    );
    if (contentEditable) return contentEditable;

    // 3. 匹配非 pending 占位符的有效 textarea（严禁将 SSR 阶段的 #pending-home-input 当作已就绪输入框）
    const nonPendingTextareas = Array.from(
      document.querySelectorAll<HTMLTextAreaElement>('textarea:not([aria-hidden="true"])')
    ).filter(
      (el) => el.id !== 'pending-home-input' && el.getAttribute('data-id') !== 'root'
    );
    if (nonPendingTextareas.length > 0 && nonPendingTextareas[0]) {
      return nonPendingTextareas[0];
    }

    return null;
  }

  private isNonSendButton(b: HTMLElement): boolean {
    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
    const title = (b.getAttribute('title') || '').toLowerCase();
    const testid = (b.getAttribute('data-testid') || '').toLowerCase();
    const text = (b.innerText || b.textContent || '').trim().toLowerCase();
    const combined = `${aria} ${title} ${testid} ${text}`;

    // 严格黑名单：杜绝误点 ChatGPT 语音模式、听写/麦克风、附件、搜索、深度研究、停止等非发送按钮
    const forbiddenKeywords = [
      'voice',
      'speech',
      'dictate',
      'mic',
      'audio',
      'live',
      'attach',
      'upload',
      'file',
      'search',
      'reason',
      'research',
      'tool',
      'plus',
      'composer-plus',
      'menu',
      'model',
      'stop',
      'cancel',
      'close',
      'record',
      'listen',
      '语音',
      '听写',
      '麦克风',
      '通话',
      '朗读',
      '录音',
      '附件',
      '上传',
      '文件',
      '搜索',
      '联网',
      '推理',
      '深度研究',
      '工具',
      '添加',
      '菜单',
      '模型',
      '停止',
      '取消',
      '关闭',
    ];
    return forbiddenKeywords.some((kw) => combined.includes(kw));
  }

  private findSendButton(): HTMLElement | null {
    const directSelectors = [
      'button[data-testid="send-button"]',
      'button[data-testid="fruitjuice-send-button"]',
      'button[aria-label*="Send prompt" i]',
      'button[aria-label*="Send message" i]',
      'button[aria-label="Send" i]',
      'button[aria-label*="发送提示词"]',
      'button[aria-label*="发送消息"]',
      'button[aria-label="发送"]',
    ];
    for (const sel of directSelectors) {
      const btn = document.querySelector<HTMLElement>(sel);
      if (btn && !this.isNonSendButton(btn)) {
        return btn;
      }
    }

    // 向上从输入框的父级表单中寻找明确具备发送语义的操作按钮
    // 严禁盲目点击“表单最后一个带 svg 的按钮”，因为输入框为空或未同步时右下角就是语音输入按钮！
    const input = this.findInputElement();
    const form = input?.closest('form');
    if (form) {
      const candidates = Array.from(form.querySelectorAll<HTMLElement>('button'));
      const sendCandidate = candidates.reverse().find((b) => {
        if (this.isNonSendButton(b)) return false;

        const type = (b.getAttribute('type') || '').toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const title = (b.getAttribute('title') || '').toLowerCase();
        const testid = (b.getAttribute('data-testid') || '').toLowerCase();
        const combined = `${aria} ${title} ${testid}`;

        return (
          type === 'submit' ||
          combined.includes('send') ||
          combined.includes('submit') ||
          combined.includes('发送') ||
          combined.includes('提交')
        );
      });
      if (sendCandidate) return sendCandidate;
    }

    return null;
  }

  public findStopButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('button[data-testid="stop-button"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="Stop streaming" i]') ||
      document.querySelector<HTMLElement>('button[aria-label*="Stop generating" i]') ||
      document.querySelector<HTMLElement>('button[aria-label*="停止生成"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="停止响应"]') ||
      document.querySelector<HTMLElement>('button[aria-label*="停止流"]') ||
      document.querySelector<HTMLElement>('form button[aria-label="Stop" i]') ||
      document.querySelector<HTMLElement>('form button[aria-label="停止"]')
    );
  }

  /**
   * 从 ChatGPT 助手轮次（<article> 或消息容器）中纯净提取正式回复 Markdown：
   * 1. 彻底剔除思维链/推理摘要抽屉（即使其在 DOM 顺序中位于正式回复之后！）、工具调用、SVG 图表与工具栏
   * 2. 优先从 [data-message-author-role="assistant"] 内的所有顶层 .markdown/.prose 合并提取
   */
  private extractFormalMarkdownFromTurn(turnEl: HTMLElement): string {
    const THINK_AND_NOISE_SELECTOR = [
      'details',
      '[data-testid*="thought" i]',
      '[data-testid*="thinking" i]',
      '[data-testid*="reasoning" i]',
      '[data-testid*="activity" i]',
      '[data-testid*="search" i]',
      '[data-testid*="tool" i]',
      '[data-message-author-role="tool"]',
      '[data-message-author-role="system"]',
      '[class*="thought" i]',
      '[class*="thinking" i]',
      '[class*="reasoning" i]',
      '[aria-label*="Thought" i]',
      '[aria-label*="思考"]',
      'svg',
      'canvas',
      'button',
      '[role="toolbar"]',
      '[class*="toolbar"]',
      '[data-testid*="action"]',
    ].join(', ');

    const isThinkingHeaderLine = (text: string): boolean => {
      const firstLine = text.trim().split('\n')[0]?.trim() || '';
      if (!firstLine || firstLine.length > 80) return false;
      return /^(Thought for|Thinking|Reasoning|Activity|已思考|思考了|已深度思考|深度思考|思考过程)/i.test(firstLine);
    };

    const clone = turnEl.cloneNode(true) as HTMLElement;

    // 1. 移除显式思维链、推理抽屉、工具块、图表与工具栏
    clone.querySelectorAll(THINK_AND_NOISE_SELECTOR).forEach((n) => n.remove());

    // 2. 移除采用纯 Tailwind 混淆类名、但首行以 "Thought for / 已思考 / 思考了" 开头的思维链兄弟面板
    const directBlocks = Array.from(clone.querySelectorAll<HTMLElement>('div, section, aside'));
    for (const block of directBlocks) {
      if (!block.isConnected) continue;
      // 跳过本身包含正式 assistant 标记的外层容器，只移除独立的思考抽屉块
      if (block.matches('[data-message-author-role="assistant"]') || block.querySelector('[data-message-author-role="assistant"]')) {
        continue;
      }
      const text = (block.innerText || block.textContent || '').trim();
      if (isThinkingHeaderLine(text)) {
        block.remove();
      }
    }

    // 3. 若轮次内存在明确的 [data-message-author-role="assistant"] 节点，优先只在这些正式助手节点内提取正文，
    //    彻底隔离挂在 <article> 尾部的思维链/活动侧栏兄弟节点！
    const assistantNodes = Array.from(clone.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"]'));
    const searchRoots: HTMLElement[] = assistantNodes.length > 0 ? assistantNodes : [clone];

    const formalBlocks: string[] = [];
    for (const root of searchRoots) {
      const mdCandidates = Array.from(
        root.querySelectorAll<HTMLElement>('.markdown, [class*="markdown"], .prose, [class*="prose"]')
      ).filter((el) => {
        // 只保留顶层 markdown 容器，避免嵌套重复提取
        const parentMd = el.parentElement?.closest('.markdown, [class*="markdown"], .prose, [class*="prose"]');
        if (parentMd && root.contains(parentMd)) return false;
        const t = (el.innerText || el.textContent || '').trim();
        if (!t || isThinkingHeaderLine(t)) return false;
        return true;
      });

      if (mdCandidates.length > 0) {
        for (const mdEl of mdCandidates) {
          const md = domToMarkdown(mdEl);
          const text = (md && md.trim().length > 0) ? md.trim() : (mdEl.innerText || mdEl.textContent || '').trim();
          if (text) formalBlocks.push(text);
        }
      } else {
        const md = domToMarkdown(root);
        const text = (md && md.trim().length > 0) ? md.trim() : (root.innerText || root.textContent || '').trim();
        if (text && !isThinkingHeaderLine(text)) {
          formalBlocks.push(text);
        }
      }
    }

    const joined = formalBlocks.join('\n\n').trim();
    if (joined.length > 0) {
      return stripThinkBlocks(joined).cleaned.trim();
    }

    const fallbackMd = domToMarkdown(clone);
    const fallbackText = (fallbackMd && fallbackMd.trim().length > 0)
      ? fallbackMd.trim()
      : (clone.innerText || clone.textContent || '').trim();
    return stripThinkBlocks(fallbackText).cleaned.trim();
  }

  private findLatestAssistantMessageElement(): HTMLElement | null {
    const isUserArticle = (art: HTMLElement): boolean => {
      if (art.getAttribute('data-message-author-role') === 'user') return true;
      if (art.querySelector('[data-message-author-role="user"]')) return true;
      if (art.querySelector('button[aria-label*="Edit"], button[aria-label*="编辑"]')) return true;
      return false;
    };

    // 1. 现代 ChatGPT 核心架构：优先获取最新一轮完整的非用户 <article>（避免轮次内部拆分多个 markdown/图表子块时只命中尾部 68 字图表！）
    const articles = Array.from(document.querySelectorAll<HTMLElement>('article'));
    if (articles.length > 0) {
      const nonUserArticles = articles.filter((art) => !isUserArticle(art));
      if (nonUserArticles.length > 0) {
        const lastArt = nonUserArticles[nonUserArticles.length - 1]!;
        if ((lastArt.textContent || '').trim().length > 0) {
          return lastArt;
        }
      }
    }

    // 2. 查找所有包含 assistant 标记的明确容器（若处于同一 article 下则返回整个 article）
    const assistantRoles = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-message-author-role="assistant"], [data-message-model-slug], div[class*="agent-turn"]'
      )
    );
    if (assistantRoles.length > 0) {
      const last = assistantRoles[assistantRoles.length - 1]!;
      const outerArticle = last.closest<HTMLElement>('article');
      if (outerArticle && !isUserArticle(outerArticle)) {
        return outerArticle;
      }
      const md = last.querySelector<HTMLElement>(
        '.markdown, [class*="markdown"], .prose, [class*="prose"], div[class*="text-message"], div.whitespace-pre-wrap'
      ) || last;
      if ((md.textContent || '').trim().length > 0) {
        return md;
      }
    }

    // 3. 特征锚点定位：通过助手专属操作按钮（复制回答、点赞/点踩、朗读）反向溯源所属卡片
    const assistantButtons = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button[aria-label*="Copy"], button[aria-label*="复制"], button[aria-label*="Good response"], button[aria-label*="赞"], [data-testid*="copy"]'
      )
    );
    for (let i = assistantButtons.length - 1; i >= 0; i--) {
      const btn = assistantButtons[i]!;
      const turnContainer = btn.closest<HTMLElement>(
        'article, div[class*="agent-turn"], div[data-message-id], div[class*="conversation-turn"]'
      );
      if (turnContainer && !isUserArticle(turnContainer)) {
        const md = turnContainer.querySelector<HTMLElement>(
          '.markdown, [class*="markdown"], .prose, [class*="prose"], div[class*="text-message"], div.whitespace-pre-wrap'
        ) || turnContainer;
        if ((md.textContent || '').trim().length > 0) {
          return md;
        }
      }
    }

    // 4. 降级：查询页面中所有的 markdown / prose / 富文本容器
    const mdElements = Array.from(
      document.querySelectorAll<HTMLElement>(
        'div[class*="markdown"], div[class*="prose"], .markdown, .prose, div[class*="text-message"]'
      )
    ).filter((el) => {
      const art = el.closest('article');
      if (art && isUserArticle(art)) return false;
      return true;
    });

    if (mdElements.length > 0) {
      const lastMd = mdElements[mdElements.length - 1]!;
      if ((lastMd.textContent || '').trim().length > 0) {
        return lastMd;
      }
    }

    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

export const chatGPTAdapter = new ChatGPTAdapter();
adapterRegistry.register(chatGPTAdapter);
