import type { SSEEvent } from './sse-parser';

export interface ChatGPTParseResult {
  text: string;
  isDone: boolean;
  mode: 'SNAPSHOT' | 'DELTA' | 'DONE';
}

/**
 * ChatGPT 双模流式解析器
 * 自动识别全量快照 (message.content.parts 覆盖) 与增量 Delta Encoding (JSON Pointer 累加)
 */
export class ChatGPTStreamParser {
  private currentText = '';

  public parseEvent(event: SSEEvent): ChatGPTParseResult | null {
    const rawData = event.data?.trim();
    if (!rawData) return null;

    // 终止标记
    if (rawData === '[DONE]') {
      return {
        text: this.currentText,
        isDone: true,
        mode: 'DONE',
      };
    }

    try {
      const json = JSON.parse(rawData);

      // 1. Delta Encoding 模式 (event: delta 或存在 v, p, o)
      if (event.event === 'delta' || (json.v !== undefined && json.p !== undefined)) {
        if (json.o === 'append' && typeof json.v === 'string') {
          // 只接收指向正文部分的增量
          if (typeof json.p === 'string' && json.p.includes('/parts/')) {
            this.currentText += json.v;
            return {
              text: this.currentText,
              isDone: false,
              mode: 'DELTA',
            };
          }
        }
        return null;
      }

      // 2. 全量快照模式 (message.content.parts)
      if (json.message) {
        const role = json.message.author?.role;
        // 门卫：严格过滤非 assistant 节点（如 user 回显或 tool 节点）
        if (role && role !== 'assistant') {
          return null;
        }

        const parts = json.message.content?.parts;
        if (Array.isArray(parts) && parts.length > 0) {
          // 全量快照直接覆盖内部缓冲区，严禁 +=
          this.currentText = parts.filter((p: unknown) => typeof p === 'string').join('');
          return {
            text: this.currentText,
            isDone: false,
            mode: 'SNAPSHOT',
          };
        }
      }
    } catch {
      // 容错忽略非 JSON 帧
    }

    return null;
  }

  public getCurrentText(): string {
    return this.currentText;
  }

  public reset(): void {
    this.currentText = '';
  }
}
