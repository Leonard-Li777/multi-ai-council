import type { SupportedSite, ProviderStatus } from '../types/review-job';

/**
 * P2 预留接口（本步仅占位）：网络层原始响应拦截源
 * export interface ResponseSource {
 *   captureStream(onChunk: (chunk: string) => void): Promise<void>;
 * }
 */

export interface AISiteAdapter {
  readonly siteName: SupportedSite;
  readonly urlPattern: RegExp;
  readonly adapterVersion: string;

  /**
   * 检查页面是否就绪（已进入对话界面并存在输入框）
   */
  isReady(): Promise<boolean>;

  /**
   * 检查是否存在阻断状态（验证码/未登录/限流）
   */
  checkBlocker(): Promise<'OK' | 'CAPTCHA' | 'RATE_LIMIT' | 'NOT_LOGGED_IN' | 'DOM_CHANGED'>;

  /**
   * 触发新建对话（优先导航，或点击新建按钮）
   */
  createNewChat(): Promise<void>;

  /**
   * 获取当前会话远程 URL
   */
  getConversationUrl(): string;

  /**
   * 注入提示词并点击发送
   */
  sendPrompt(prompt: string): Promise<boolean>;

  /**
   * 校验发送是否真实成功并进入对话树
   */
  validateSubmission(): Promise<boolean>;

  /**
   * 启动生成监听（结合四信号与思考块过滤）
   */
  listenGeneration(
    onUpdate: (snapshot: string, cleaned: string) => void,
    onDone: (finalCleaned: string) => void
  ): () => void;

  /**
   * 关闭异常弹窗（如提示账户切换、会话过期等）
   */
  dismissDialogs?(): boolean;

  /**
   * 智能自愈与状态恢复
   */
  autoRecoverAndContinue?(
    prompt: string,
    onUpdate: (snapshot: string, cleaned: string) => void,
    onDone: (finalCleaned: string) => void
  ): Promise<'DONE' | 'STREAMING' | 'SENT' | 'FAILED'>;
}

class AdapterRegistry {
  private adapters = new Map<SupportedSite, AISiteAdapter>();

  public register(adapter: AISiteAdapter) {
    this.adapters.set(adapter.siteName, adapter);
  }

  public get(siteName: SupportedSite): AISiteAdapter | undefined {
    return this.adapters.get(siteName);
  }

  public has(siteName: SupportedSite): boolean {
    return this.adapters.has(siteName);
  }
}

export const adapterRegistry = new AdapterRegistry();
