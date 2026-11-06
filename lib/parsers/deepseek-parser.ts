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
      const delta = choice?.delta || json.delta;

      // 1. 深度思考阶段 (reasoning_content / thinking)
      const thinking = delta?.reasoning_content || delta?.thinking || json.reasoning_content;
      if (typeof thinking === 'string' && thinking.length > 0) {
        this.reasoningText += thinking;
        return {
          kind: 'THINKING',
          text: thinking,
          isDone: Boolean(choice?.finish_reason || json.finish_reason),
        };
      }

      // 2. 正文生成阶段 (content / text / response 广泛兼容)
      const content =
        (typeof delta?.content === 'string' ? delta.content : null) ??
        (typeof delta?.text === 'string' ? delta.text : null) ??
        (typeof choice?.text === 'string' ? choice.text : null) ??
        (typeof json.content === 'string' ? json.content : null) ??
        (typeof json.text === 'string' ? json.text : null) ??
        (typeof json.response === 'string' ? json.response : null) ??
        (typeof json.v === 'string' ? json.v : null);

      if (typeof content === 'string' && content.length > 0) {
        this.contentText += content;
        return {
          kind: 'CONTENT',
          text: content,
          isDone: Boolean(choice?.finish_reason || json.finish_reason),
        };
      }

      // 3. 独立完成信号 (无新 delta)
      if (choice?.finish_reason || json.finish_reason) {
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
