import { IncrementalSSEParser, type SSEEvent } from './sse-parser';
import { ChatGPTStreamParser } from './chatgpt-parser';
import { DeepSeekStreamParser } from './deepseek-parser';
import { parseClaudeEvent, parseQwenEvent, parseWenxinChunk } from './protocol-adapters';

export type SemanticEvent =
  | { type: 'THINKING'; text: string }
  | { type: 'DELTA'; text: string }
  | { type: 'SNAPSHOT'; text: string }
  | { type: 'DONE'; endReason?: string }
  | { type: 'PARTIAL'; endReason?: string }
  | { type: 'ERROR'; error?: unknown };

export type SemanticEventCallback = (event: SemanticEvent) => void;

/**
 * 严格白名单正向判定是否为合规的 AI 消息生成端点 (GENERATION)
 * 无法匹配的全部归为 UNKNOWN 旁路杂流，绝不抢占锁
 */
export function matchGenerationEndpoint(url: string): 'CHATGPT' | 'DEEPSEEK' | 'CLAUDE' | 'QWEN' | 'WENXIN' | 'UNKNOWN' {
  if (!url) return 'UNKNOWN';

  // 严格排除标题、会话列表、遥测与设置接口
  if (
    url.includes('/gen_title') ||
    url.includes('/conversation_title') ||
    url.includes('/feedback') ||
    url.includes('/backend-api/conversations') // 排除 GET /backend-api/conversations 历史列表
  ) {
    return 'UNKNOWN';
  }

  // 1. ChatGPT: 必须精准匹配 /backend-api/conversation（单数，可带查询参数）
  if (/\/backend-api\/conversation(\?.*)?$/.test(url)) {
    return 'CHATGPT';
  }

  // 2. DeepSeek: /api/v0/chat/completion
  if (/\/api\/v0\/chat\/completion(\?.*)?$/.test(url) || url.includes('/api/v0/chat/completion')) {
    return 'DEEPSEEK';
  }

  // 3. Claude: /api/organizations/.../completion
  if (/\/api\/organizations\/.*\/completion(\?.*)?$/.test(url)) {
    return 'CLAUDE';
  }

  // 4. 通义千问: 限制于 qwen 域或 /api/...chat 路径，且排除 auth/login/settings
  if (
    (url.includes('chat.qwen.ai') || url.includes('tongyi')) &&
    /\/api\/.*chat(\?.*)?$/.test(url) &&
    !url.includes('/auth/')
  ) {
    return 'QWEN';
  }

  // 5. 百度文心一言: /eb/chat/conversation
  if (/\/eb\/chat\/conversation(\?.*)?$/.test(url) || url.includes('/eb/chat/conversation')) {
    return 'WENXIN';
  }

  return 'UNKNOWN';
}

/**
 * 统一语义流式解析器 (Unified Semantic Stream Parser)
 * 将各站 rawText 转化为高维 SemanticEvent 序列
 */
export class UnifiedSemanticStreamParser {
  private endpointType: ReturnType<typeof matchGenerationEndpoint>;
  private onEvent: SemanticEventCallback;
  private sseParser?: IncrementalSSEParser;
  private chatGptParser?: ChatGPTStreamParser;
  private deepSeekParser?: DeepSeekStreamParser;

  constructor(url: string, onEvent: SemanticEventCallback) {
    this.endpointType = matchGenerationEndpoint(url);
    this.onEvent = onEvent;

    if (this.endpointType === 'CHATGPT') {
      this.chatGptParser = new ChatGPTStreamParser();
      this.sseParser = new IncrementalSSEParser((evt) => this.handleChatGPTEvent(evt));
    } else if (this.endpointType === 'DEEPSEEK') {
      this.deepSeekParser = new DeepSeekStreamParser();
      this.sseParser = new IncrementalSSEParser((evt) => this.handleDeepSeekEvent(evt));
    } else if (this.endpointType === 'CLAUDE') {
      this.sseParser = new IncrementalSSEParser((evt) => this.handleClaudeEvent(evt));
    } else if (this.endpointType === 'QWEN') {
      this.sseParser = new IncrementalSSEParser((evt) => this.handleQwenEvent(evt));
    }
  }

  public feedRawText(rawText: string): void {
    if (!rawText) return;

    if (this.endpointType === 'WENXIN') {
      // 百度文心一言为 Chunked JSON，直接解析分片
      const res = parseWenxinChunk(rawText);
      if (res) {
        if (res.text) {
          this.onEvent({ type: 'DELTA', text: res.text });
        }
        if (res.isDone) {
          this.onEvent({ type: 'DONE', endReason: 'EOF' });
        }
      }
      return;
    }

    if (this.sseParser) {
      this.sseParser.feed(rawText);
    }
  }

  private handleChatGPTEvent(evt: SSEEvent): void {
    if (!this.chatGptParser) return;
    const res = this.chatGptParser.parseEvent(evt);
    if (!res) return;

    // 核心修复 (Defect 1):
    // 无论 ChatGPT 内部是 parts 快照模式还是 delta JSON pointer 累加模式，
    // ChatGPTStreamParser 内部均已维护自洽的完整文本 getCurrentText()。
    // 对外统一作为 SNAPSHOT 派发，彻底根除下游 responseSnapshot += 导致的 O(N^2) 字符几何膨胀！
    if (res.mode === 'SNAPSHOT' || res.mode === 'DELTA') {
      this.onEvent({ type: 'SNAPSHOT', text: this.chatGptParser.getCurrentText() });
    }
    if (res.isDone) {
      this.onEvent({ type: 'DONE', endReason: 'EOF' });
    }
  }

  private handleDeepSeekEvent(evt: SSEEvent): void {
    if (!this.deepSeekParser) return;
    const res = this.deepSeekParser.parseEvent(evt);
    if (!res) return;

    if (res.kind === 'THINKING') {
      this.onEvent({ type: 'THINKING', text: res.text });
    } else if (res.kind === 'CONTENT') {
      this.onEvent({ type: 'DELTA', text: res.text });
    }
    if (res.isDone) {
      this.onEvent({ type: 'DONE', endReason: 'EOF' });
    }
  }

  private handleClaudeEvent(evt: SSEEvent): void {
    const res = parseClaudeEvent(evt);
    if (!res) return;

    if (res.text) {
      this.onEvent({ type: 'DELTA', text: res.text });
    }
    if (res.isDone) {
      this.onEvent({ type: 'DONE', endReason: 'EOF' });
    }
  }

  private handleQwenEvent(evt: SSEEvent): void {
    const res = parseQwenEvent(evt);
    if (!res) return;

    // 核心修复 (Defect 4): 区分 Qwen 快照模式与增量模式
    if (res.text) {
      if (res.mode === 'SNAPSHOT') {
        this.onEvent({ type: 'SNAPSHOT', text: res.text });
      } else {
        this.onEvent({ type: 'DELTA', text: res.text });
      }
    }
    if (res.isDone) {
      this.onEvent({ type: 'DONE', endReason: 'EOF' });
    }
  }

  public reset(): void {
    this.sseParser?.reset();
    this.chatGptParser?.reset();
    this.deepSeekParser?.reset();
  }
}
