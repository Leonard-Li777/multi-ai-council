import { describe, it, expect } from 'vitest';
import { IncrementalSSEParser, type SSEEvent } from '../lib/parsers/sse-parser';

describe('AC3: IncrementalSSEParser 规范与零丢包分帧', () => {
  it('正确解析标准的 data 行与连续空行事件界限', () => {
    const events: SSEEvent[] = [];
    const parser = new IncrementalSSEParser((evt) => events.push(evt));

    parser.feed('data: hello\n\ndata: world\n\n');

    expect(events).toHaveLength(2);
    expect(events[0]?.data).toBe('hello');
    expect(events[1]?.data).toBe('world');
  });

  it('支持 multi-line data: 自动用 \\n 拼接', () => {
    const events: SSEEvent[] = [];
    const parser = new IncrementalSSEParser((evt) => events.push(evt));

    parser.feed('data: line 1\ndata: line 2\ndata: line 3\n\n');

    expect(events).toHaveLength(1);
    expect(events[0]?.data).toBe('line 1\nline 2\nline 3');
  });

  it('规范切分 \\r\\n、\\n 与 \\r 混合换行', () => {
    const events: SSEEvent[] = [];
    const parser = new IncrementalSSEParser((evt) => events.push(evt));

    parser.feed('event: delta\r\ndata: crlf\r\n\r\nevent: ping\ndata: lf\n\n');

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ event: 'delta', data: 'crlf', id: undefined });
    expect(events[1]).toEqual({ event: 'ping', data: 'lf', id: undefined });
  });

  it('跨 chunk 随机切断（包括切在换行符中间）时，100% 保持事件完整与 0 抛错', () => {
    const events: SSEEvent[] = [];
    const parser = new IncrementalSSEParser((evt) => events.push(evt));

    const raw = 'data: {"token":"A"}\n\ndata: {"token":"B"}\n\ndata: [DONE]\n\n';

    // 每次灌 3 个字符，模拟极其碎片的网络分片
    for (let i = 0; i < raw.length; i += 3) {
      parser.feed(raw.slice(i, i + 3));
    }

    expect(events).toHaveLength(3);
    expect(events[0]?.data).toBe('{"token":"A"}');
    expect(events[1]?.data).toBe('{"token":"B"}');
    expect(events[2]?.data).toBe('[DONE]');
  });

  it('跨 chunk 切在 \\r 与 \\n 中间时，绝不产生虚假空行撕裂', () => {
    const events: SSEEvent[] = [];
    const parser = new IncrementalSSEParser((evt) => events.push(evt));

    // 块 1 以 \r 结尾
    parser.feed('data: hello world\r');
    // 块 2 以 \n\r\n 结尾
    parser.feed('\n\r\n');

    expect(events).toHaveLength(1);
    expect(events[0]?.data).toBe('hello world');
  });

  it('正确支持无 data: 仅有 event: 的控制帧 (如 Claude message_stop)', () => {
    const events: SSEEvent[] = [];
    const parser = new IncrementalSSEParser((evt) => events.push(evt));

    parser.feed('event: message_stop\n\n');

    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('message_stop');
    expect(events[0]?.data).toBe('');
  });

  it('流 EOF 时末尾无 \\n\\n 结尾的残包经 flush() 完整释放，解决丢失最后两句缺陷', () => {
    const events: SSEEvent[] = [];
    const parser = new IncrementalSSEParser((evt) => events.push(evt));

    // 输入无结尾双换行的最后两句
    parser.feed('data: {"delta":{"text":"这是最后两句内容。"}}');
    expect(events).toHaveLength(0); // 此时因缺少换行还卡在 buffer

    // 流 EOF 时调用 flush
    parser.flush();
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toBe('{"delta":{"text":"这是最后两句内容。"}}');
  });
});
