import type { SSEEvent } from './sse-parser';

export type DeepSeekChunkKind = 'THINKING' | 'CONTENT' | 'DONE';

export interface DeepSeekParseResult {
  kind: DeepSeekChunkKind;
  text: string;
  isDone: boolean;
}

/**
 * DeepSeek R1 流式协议解析器
 * 分离提取 delta.reasoning_content (深度思考阶段) 与 delta.content (正式回复阶段)
 */
export class DeepSeekStreamParser {
  private reasoningText = '';
  private contentText = '';
  private inThinkBlock = false;

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
      const choice = json.choices?.[0];
      const delta = choice?.delta || json.delta;
      const isDone = Boolean(choice?.finish_reason || json.finish_reason);

      // 1. 深度思考阶段 (reasoning_content / thinking / type:thinking 广泛兼容)
      const isExplicitThinking =
        Boolean(delta?.reasoning_content || delta?.thinking || json.reasoning_content) ||
        delta?.type === 'thinking' ||
        choice?.type === 'thinking' ||
        json?.type === 'thinking' ||
        delta?.phase === 'thinking' ||
        choice?.phase === 'thinking' ||
        json?.phase === 'thinking' ||
        delta?.role === 'thinking' ||
        (typeof json?.p === 'string' && (json.p.includes('thinking') || json.p.includes('reasoning')));

      if (isExplicitThinking) {
        const thinking =
          (typeof delta?.reasoning_content === 'string' ? delta.reasoning_content : null) ??
          (typeof delta?.thinking === 'string' ? delta.thinking : null) ??
          (typeof json.reasoning_content === 'string' ? json.reasoning_content : null) ??
          (typeof delta?.content === 'string' ? delta.content : null) ??
          (typeof delta?.text === 'string' ? delta.text : null) ??
          (typeof json.content === 'string' ? json.content : null) ??
          (typeof json.v === 'string' ? json.v : null);

        if (typeof thinking === 'string' && thinking.length > 0) {
          this.reasoningText += thinking;
          return {
            kind: 'THINKING',
            text: thinking,
            isDone,
          };
        }
      }

      // 2. 正文生成阶段 (content / text / response 广泛兼容)
      const rawContent =
        (typeof delta?.content === 'string' ? delta.content : null) ??
        (typeof delta?.text === 'string' ? delta.text : null) ??
        (typeof choice?.text === 'string' ? choice.text : null) ??
        (typeof json.content === 'string' ? json.content : null) ??
        (typeof json.text === 'string' ? json.text : null) ??
        (typeof json.response === 'string' ? json.response : null) ??
        (typeof json.v === 'string' ? json.v : null);

      if (typeof rawContent === 'string' && rawContent.length > 0) {
        // 流式状态机：若正文流中包含原生 <think>...</think> 标签，将其分离进思维链
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
          // 当前 chunk 全为思维链标签内的内容，派发 THINKING 保持心跳
          return {
            kind: 'THINKING',
            text: thinkingContent,
            isDone,
          };
        }
      }

      // 3. 独立完成信号 (无新 delta)
      if (isDone) {
        return {
          kind: 'DONE',
          text: this.contentText,
          isDone: true,
        };
      }
    } catch {
      // 容错忽略非 JSON 帧
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
  }
}
