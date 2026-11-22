import type { SSEEvent } from './sse-parser';

export type DeepSeekChunkKind = 'THINKING' | 'CONTENT' | 'DONE';

export interface DeepSeekParseResult {
  kind: DeepSeekChunkKind;
  text: string;
  isDone: boolean;
}

type ActivePatchPhase = 'UNKNOWN' | 'THINKING' | 'CONTENT' | 'IGNORE';

const IGNORED_PATCH_PATH_KEYWORDS = [
  'status',
  'elapsed',
  'search',
  'citation',
  'title',
  'usage',
  'token',
  'message_id',
  'stage',
  'ban',
  'finish_reason',
  'tips',
  'accumulated',
  'quasi_status',
];

const CONTROL_STATUS_VALUES = new Set(['FINISHED', 'WIP', 'INCOMPLETE', 'FAILED', 'ABORTED']);

/**
 * DeepSeek R1 流式协议解析器
 * 全面支持 OpenAI 兼容格式与 DeepSeek Web 端 JSON-Patch (p/o/v & response/fragments) 状态机协议，
 * 严格分离深度思考思维链 (THINK / reasoning_content) 与正式回复正文 (RESPONSE / content)。
 */
export class DeepSeekStreamParser {
  private reasoningText = '';
  private contentText = '';
  private inThinkBlock = false;
  // DeepSeek Web 端 JSON-Patch 协议会在后续分片省略 p 字段，必须跨帧记忆当前所属阶段
  private activePhase: ActivePatchPhase = 'UNKNOWN';

  public parseEvent(event: SSEEvent): DeepSeekParseResult | null {
    const rawData = event.data?.trim();
    if (!rawData) return null;

    if (rawData === '[DONE]') {
      return {
        kind: 'DONE',
        text: this.contentText,
        isDone: true,
      };
    }

    try {
      const json = JSON.parse(rawData);
      return this.processJsonObject(json);
    } catch {
      // 容错忽略非 JSON 帧
    }

    return null;
  }

  private processJsonObject(json: any): DeepSeekParseResult | null {
    if (!json || typeof json !== 'object') return null;

    // 0. DeepSeek Web JSON-Patch BATCH 批量操作（如 { p: 'response', o: 'BATCH', v: [...] }）
    if (json.o === 'BATCH' && Array.isArray(json.v)) {
      let contentBuf = '';
      let thinkingBuf = '';
      let doneFlag = false;

      for (const item of json.v) {
        const res = this.processJsonObject(item);
        if (!res) continue;
        if (res.kind === 'CONTENT') contentBuf += res.text;
        else if (res.kind === 'THINKING') thinkingBuf += res.text;
        if (res.isDone) doneFlag = true;
      }

      if (contentBuf.length > 0) {
        return { kind: 'CONTENT', text: contentBuf, isDone: doneFlag };
      }
      if (thinkingBuf.length > 0) {
        return { kind: 'THINKING', text: thinkingBuf, isDone: doneFlag };
      }
      if (doneFlag) {
        return { kind: 'DONE', text: this.contentText, isDone: true };
      }
      return null;
    }

    // 0.5 DeepSeek Web 初始响应快照（如 { v: { response: { fragments: [...] } } }）
    if (json.v && typeof json.v === 'object' && !Array.isArray(json.v) && json.v.response) {
      const resp = json.v.response;
      if (Array.isArray(resp.fragments)) {
        return this.processFragmentsArray(resp.fragments);
      }
      if (typeof resp.thinking_content === 'string' && resp.thinking_content.length > 0) {
        this.activePhase = 'THINKING';
        this.reasoningText += resp.thinking_content;
        return { kind: 'THINKING', text: resp.thinking_content, isDone: false };
      }
      if (typeof resp.content === 'string' && resp.content.length > 0) {
        this.activePhase = 'CONTENT';
        return this.emitFormalOrThink(resp.content, false);
      }
      return null;
    }

    // 1. 处理带有 JSON-Patch 路径 `p` 的帧，更新跨帧状态机 activePhase
    if (typeof json.p === 'string') {
      const path = json.p.toLowerCase();

      // 1a. 结束状态信号
      if (path === 'response/status' || path === 'status') {
        this.activePhase = 'IGNORE';
        if (typeof json.v === 'string' && json.v.toUpperCase() === 'FINISHED') {
          return { kind: 'DONE', text: this.contentText, isDone: true };
        }
        return null;
      }

      // 1b. 新增 fragment（决定接下来是 THINK 还是 RESPONSE 还是 SEARCH）
      if (path === 'response/fragments' || path === 'fragments') {
        if (Array.isArray(json.v)) {
          return this.processFragmentsArray(json.v);
        }
        if (json.v && typeof json.v === 'object') {
          return this.processFragmentsArray([json.v]);
        }
        return null;
      }

      // 1c. 显式思维链路径
      if (path.includes('thinking') || path.includes('reasoning')) {
        this.activePhase = 'THINKING';
        if (typeof json.v === 'string' && json.v.length > 0) {
          this.reasoningText += json.v;
          return { kind: 'THINKING', text: json.v, isDone: false };
        }
        return null;
      }

      // 1d. 忽略非正文元数据路径（如 elapsed_secs、search_results、token_usage 等）
      if (IGNORED_PATCH_PATH_KEYWORDS.some((kw) => path.includes(kw))) {
        this.activePhase = 'IGNORE';
        return null;
      }

      // 1e. fragments/-1/content 延续当前 fragment 的阶段（THINK / RESPONSE / IGNORE）
      if (path.includes('fragments') && path.endsWith('/content')) {
        if (typeof json.v === 'string' && json.v.length > 0) {
          if (this.activePhase === 'THINKING') {
            this.reasoningText += json.v;
            return { kind: 'THINKING', text: json.v, isDone: false };
          }
          if (this.activePhase === 'IGNORE') {
            return null;
          }
          return this.emitFormalOrThink(json.v, false);
        }
        return null;
      }

      // 1f. 显式正文路径 response/content 或 content
      if (path === 'response/content' || path === 'content') {
        this.activePhase = 'CONTENT';
        if (typeof json.v === 'string' && json.v.length > 0) {
          return this.emitFormalOrThink(json.v, false);
        }
        return null;
      }
    }

    // 2. 处理省略了 `p` 字段的 DeepSeek Web 简写增量帧：{ v: "..." }
    if (typeof json.v === 'string' && json.p === undefined && !json.choices && !json.delta) {
      if (json.v.length === 0) return null;

      if (this.activePhase === 'THINKING') {
        this.reasoningText += json.v;
        return { kind: 'THINKING', text: json.v, isDone: false };
      }
      if (this.activePhase === 'IGNORE') {
        return null;
      }
      if (this.activePhase === 'UNKNOWN') {
        // 关键防污染：在尚未明确进入 CONTENT 阶段前，任何孤立的 { v: "..." }（如 10 字会话自动标题）严禁当作正文！
        if (CONTROL_STATUS_VALUES.has(json.v.toUpperCase()) && json.v.toUpperCase() === 'FINISHED') {
          return { kind: 'DONE', text: this.contentText, isDone: true };
        }
        return null;
      }
      return this.emitFormalOrThink(json.v, false);
    }

    // 3. OpenAI 兼容及通用流式格式 (choices / delta / content)
    const choice = json.choices?.[0];
    const delta = choice?.delta || json.delta;
    const isDone = Boolean(choice?.finish_reason || json.finish_reason);

    // 3a. 深度思考阶段 (reasoning_content / thinking / type:thinking 广泛兼容)
    const isExplicitThinking =
      Boolean(delta?.reasoning_content || delta?.thinking || json.reasoning_content) ||
      delta?.type === 'thinking' ||
      choice?.type === 'thinking' ||
      json?.type === 'thinking' ||
      delta?.phase === 'thinking' ||
      choice?.phase === 'thinking' ||
      json?.phase === 'thinking' ||
      delta?.role === 'thinking';

    if (isExplicitThinking) {
      const thinking =
        (typeof delta?.reasoning_content === 'string' ? delta.reasoning_content : null) ??
        (typeof delta?.thinking === 'string' ? delta.thinking : null) ??
        (typeof json.reasoning_content === 'string' ? json.reasoning_content : null) ??
        (typeof delta?.content === 'string' ? delta.content : null) ??
        (typeof delta?.text === 'string' ? delta.text : null) ??
        (typeof json.content === 'string' ? json.content : null);

      if (typeof thinking === 'string' && thinking.length > 0) {
        this.reasoningText += thinking;
        return {
          kind: 'THINKING',
          text: thinking,
          isDone,
        };
      }
    }

    // 3b. 正文生成阶段 (content / text / response 广泛兼容)
    const rawContent =
      (typeof delta?.content === 'string' ? delta.content : null) ??
      (typeof delta?.text === 'string' ? delta.text : null) ??
      (typeof choice?.text === 'string' ? choice.text : null) ??
      (typeof json.content === 'string' ? json.content : null) ??
      (typeof json.text === 'string' ? json.text : null) ??
      (typeof json.response === 'string' ? json.response : null);

    if (typeof rawContent === 'string' && rawContent.length > 0) {
      return this.emitFormalOrThink(rawContent, isDone);
    }

    // 4. 独立完成信号 (无新 delta)
    if (isDone) {
      return {
        kind: 'DONE',
        text: this.contentText,
        isDone: true,
      };
    }

    return null;
  }

  /**
   * 处理 DeepSeek Web fragments 数组，精准切换 THINK / RESPONSE / IGNORE 状态
   */
  private processFragmentsArray(fragments: any[]): DeepSeekParseResult | null {
    let contentBuf = '';
    let thinkingBuf = '';

    for (const frag of fragments) {
      if (!frag || typeof frag !== 'object') continue;
      const fragType = typeof frag.type === 'string' ? frag.type.toUpperCase() : '';

      if (fragType === 'THINK' || fragType === 'THINKING' || fragType === 'REASONING') {
        this.activePhase = 'THINKING';
        if (typeof frag.content === 'string' && frag.content.length > 0) {
          this.reasoningText += frag.content;
          thinkingBuf += frag.content;
        }
      } else if (fragType === 'RESPONSE' || fragType === 'ANSWER' || fragType === 'TEXT') {
        this.activePhase = 'CONTENT';
        if (typeof frag.content === 'string' && frag.content.length > 0) {
          const { formalContent, thinkingContent } = this.filterThinkTags(frag.content);
          if (thinkingContent.length > 0) {
            this.reasoningText += thinkingContent;
            thinkingBuf += thinkingContent;
          }
          if (formalContent.length > 0) {
            this.contentText += formalContent;
            contentBuf += formalContent;
          }
        }
      } else if (fragType.length > 0) {
        // 如 SEARCH / SEARCH_RESULTS / CITATION 等非正文片段
        this.activePhase = 'IGNORE';
      }
    }

    if (contentBuf.length > 0) {
      return { kind: 'CONTENT', text: contentBuf, isDone: false };
    }
    if (thinkingBuf.length > 0) {
      return { kind: 'THINKING', text: thinkingBuf, isDone: false };
    }
    return null;
  }

  private emitFormalOrThink(rawContent: string, isDone: boolean): DeepSeekParseResult | null {
    const { formalContent, thinkingContent } = this.filterThinkTags(rawContent);
    if (thinkingContent.length > 0) {
      this.reasoningText += thinkingContent;
    }

    if (formalContent.length > 0) {
      this.contentText += formalContent;
      return {
        kind: 'CONTENT',
        text: formalContent,
        isDone,
      };
    } else if (thinkingContent.length > 0) {
      return {
        kind: 'THINKING',
        text: thinkingContent,
        isDone,
      };
    }
    return null;
  }

  /**
   * 跨 Chunk 的 <think> 标签状态机解析，只抽取正式回复
   */
  private filterThinkTags(text: string): { formalContent: string; thinkingContent: string } {
    let formalContent = '';
    let thinkingContent = '';
    let remaining = text;

    while (remaining.length > 0) {
      if (!this.inThinkBlock) {
        const thinkStart = remaining.indexOf('<think>');
        if (thinkStart !== -1) {
          formalContent += remaining.slice(0, thinkStart);
          this.inThinkBlock = true;
          remaining = remaining.slice(thinkStart + 7);
        } else {
          formalContent += remaining;
          break;
        }
      } else {
        const thinkEnd = remaining.indexOf('</think>');
        if (thinkEnd !== -1) {
          thinkingContent += remaining.slice(0, thinkEnd);
          this.inThinkBlock = false;
          remaining = remaining.slice(thinkEnd + 8);
        } else {
          thinkingContent += remaining;
          break;
        }
      }
    }

    return { formalContent, thinkingContent };
  }

  public getReasoningText(): string {
    return this.reasoningText;
  }

  public getContentText(): string {
    return this.contentText;
  }

  public reset(): void {
    this.reasoningText = '';
    this.contentText = '';
    this.inThinkBlock = false;
    this.activePhase = 'UNKNOWN';
  }
}
