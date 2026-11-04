/**
 * 单个模型站点的生命周期状态
 */
export type ProviderStatus =
  | 'PENDING'          // 排队等待调度
  | 'OPENING_TAB'      // 正在创建或获取标签页
  | 'WAITING_READY'    // 标签页就绪检测中（等待输入框/登录）
  | 'SENDING'          // 正在模拟写入输入框并提交
  | 'STREAMING'        // 正在流式接收回复
  | 'DONE'             // 四信号判定完成
  | 'PARTIAL'          // 部分截断/降级完成
  | 'BLOCKED_LOGIN'    // 未登录
  | 'BLOCKED_CAPTCHA'  // 遇到人机验证/Cloudflare
  | 'RATE_LIMITED'     // 触发限流
  | 'TIMEOUT'          // 超时未完成
  | 'TAB_CLOSED'       // 标签页被异常关闭
  | 'FAILED'           // 其他未捕获错误
  | 'CANCELED';        // 人工取消

export type SupportedSite =
  | 'DeepSeek'
  | 'ChatGPT'
  | 'Claude'
  | 'Gemini'
  | 'Qwen'
  | 'Wenxin'
  | 'ChatGLM';

export interface ProviderConversationRef {
  siteName: SupportedSite;
  conversationId?: string;
  conversationUrl: string;
  lastUpdatedAt: number;
}

export interface ProviderRun {
  siteName: SupportedSite;
  tabId?: number;
  conversationRef?: ProviderConversationRef;
  status: ProviderStatus;
  responseSnapshot: string; // 实时流式快照（未清洗或半清洗，防崩溃）
  cleanedResponse: string;  // 剥离思考块后的最终 Markdown 内容
  errorReason?: string;
  startedAt?: number;
  completedAt?: number;
  retryCount: number;
}

export interface SynthesisRun {
  tabId?: number;
  status: ProviderStatus;
  anonymousMap: Record<string, SupportedSite>; // e.g. "Model A" -> "ChatGPT"
  finalMarkdown: string;
}

export interface AggregationPolicy {
  minCompletedProviders: number; // Quorum 降级最低满足数量 (首版默认 1，多站时默认 3)
  allowPartialAggregation: boolean;
  judgeProvider: 'DeepSeek';
  enabledSites: SupportedSite[];
}

export interface ReviewJob {
  id: string;
  originalPrompt: string;
  isContinuation: boolean;
  createdAt: number;
  updatedAt: number;
  deadlineAt: number;
  aggregationPolicy: AggregationPolicy;
  providerRuns: Record<string, ProviderRun>;
  synthesisRun?: SynthesisRun;
  active: boolean; // 是否为当前活跃任务
}
