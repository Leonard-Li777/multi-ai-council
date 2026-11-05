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
      if (!choice) return null;

      const delta = choice.delta;

      // 1. 深度思考阶段 (reasoning_content)
      if (delta && typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
        this.reasoningText += delta.reasoning_content;
        return {
          kind: 'THINKING',
          text: delta.reasoning_content,
          isDone: Boolean(choice.finish_reason),
        };
      }

      // 2. 正文生成阶段 (content)
      if (delta && typeof delta.content === 'string' && delta.content.length > 0) {
        this.contentText += delta.content;
        return {
          kind: 'CONTENT',
          text: delta.content,
          isDone: Boolean(choice.finish_reason),
        };
      }

      // 3. 独立完成信号 (无新 delta)
      if (choice.finish_reason) {
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

  public getReasoningText(): string {
    return this.reasoningText;
  }

  public getContentText(): string {
    return this.contentText;
  }

  public reset(): void {
    this.reasoningText = '';
    this.contentText = '';
  }
}
