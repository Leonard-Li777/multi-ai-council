/**
 * 轻量独立 IncrementalSSEParser
 * 严格按照 WHATWG SSE 规范解析换行分帧：
 * 1. 规范支持 \r\n, \n, \r 换行，安全处理跨 chunk \r|\n 切断；
 * 2. 避免对全 buffer 重复做正则分配；
 * 3. 支持 multi-line data 自动 \n 拼接；
 * 4. 支持只有 event: 无 data: 的控制帧 (如 Claude message_stop)；
 * 5. 过滤注释行 (:)。
 */

export interface SSEEvent {
  event?: string;
  data: string;
  id?: string;
}

export type SSEEventCallback = (event: SSEEvent) => void;

export class IncrementalSSEParser {
  private buffer = '';
  private onEvent: SSEEventCallback;

  constructor(onEvent: SSEEventCallback) {
    this.onEvent = onEvent;
  }

  /**
   * 灌入流式文本分片
   */
  public feed(chunk: string): void {
    if (!chunk) return;
    this.buffer += chunk;

    let searchStart = 0;

    while (searchStart < this.buffer.length) {
      // 检查跨 chunk 悬挂：若当前字符是末尾的 \r，等待下一个 chunk 确认是否接 \n
      if (this.buffer.length - 1 === searchStart && this.buffer[searchStart] === '\r') {
        this.buffer = this.buffer.slice(searchStart);
        return;
      }

      // 寻找块分界符：连续两个换行 (\n\n, \r\n\r\n, \r\r)
      const delim = this.findEventDelimiter(searchStart);
      if (!delim) {
        // 未找到完整块分界符，保留未决部分
        this.buffer = this.buffer.slice(searchStart);
        return;
      }

      const rawBlock = this.buffer.slice(searchStart, delim.blockEnd);
      searchStart = delim.nextStart;

      this.parseBlock(rawBlock);
    }

    this.buffer = '';
  }

  /**
   * 刷新并清空缓冲区中的剩余未完结事件（解决流 EOF 时最后未接双换行的残帧被丢弃问题）
   */
  public flush(): void {
    if (this.buffer.trim().length > 0) {
      this.parseBlock(this.buffer);
    }
    this.buffer = '';
  }

  /**
   * 查找事件块终止符 (\n\n, \r\n\r\n, 或 \r\r)
   */
  private findEventDelimiter(start: number): { blockEnd: number; nextStart: number } | null {
    for (let i = start; i < this.buffer.length; i++) {
      const ch = this.buffer[i];

      if (ch === '\n') {
        if (i + 1 < this.buffer.length && this.buffer[i + 1] === '\n') {
          return { blockEnd: i, nextStart: i + 2 };
        }
      } else if (ch === '\r') {
        if (i + 1 < this.buffer.length) {
          if (this.buffer[i + 1] === '\n') {
            // \r\n 序列
            if (i + 3 < this.buffer.length && this.buffer[i + 2] === '\r' && this.buffer[i + 3] === '\n') {
              return { blockEnd: i, nextStart: i + 4 };
            }
          } else if (this.buffer[i + 1] === '\r') {
            // \r\r 序列
            return { blockEnd: i, nextStart: i + 2 };
          }
        } else {
          // 末尾单个 \r，需等待更多数据
          return null;
        }
      }
    }
    return null;
  }

  /**
   * 解析单个事件块
   */
  private parseBlock(block: string): void {
    if (!block.trim()) return;

    // 按行切分（规范支持 \r\n, \n, \r）
    const lines = block.split(/\r\n|\r|\n/);
    let eventName: string | undefined;
    let eventId: string | undefined;
    const dataLines: string[] = [];

    for (const line of lines) {
      if (!line || line.startsWith(':')) {
        // 忽略空行与以 : 开头的注释/心跳行
        continue;
      }

      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('id:')) {
        eventId = line.slice(3).trim();
      } else if (line.startsWith('data:')) {
        let dataContent = line.slice(5);
        if (dataContent.startsWith(' ')) {
          dataContent = dataContent.slice(1);
        }
        dataLines.push(dataContent);
      }
    }

    // 允许有 eventName 但无 dataLines 的控制帧 (如 Claude message_stop)
    if (dataLines.length > 0 || eventName) {
      this.onEvent({
        event: eventName,
        id: eventId,
        data: dataLines.join('\n'),
      });
    }
  }

  public reset(): void {
    this.buffer = '';
  }
}
