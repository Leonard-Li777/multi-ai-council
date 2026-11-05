import { describe, it, expect } from 'vitest';
import { ChatGPTStreamParser } from '../lib/parsers/chatgpt-parser';

describe('ChatGPT 双模解析器 (Snapshot 快照 vs Delta 增量)', () => {
  it('全量快照模式：message.content.parts 每次覆写，严禁 +=', () => {
    const parser = new ChatGPTStreamParser();

    // 帧 1: "你"
    const f1 = parser.parseEvent({
      data: JSON.stringify({
        message: {
          author: { role: 'assistant' },
          content: { parts: ['你'] },
        },
      }),
    });
    expect(f1?.text).toBe('你');

    // 帧 2: 全量快照更新为 "你好，世界"
    const f2 = parser.parseEvent({
      data: JSON.stringify({
        message: {
          author: { role: 'assistant' },
          content: { parts: ['你好，世界'] },
        },
      }),
    });
    expect(f2?.text).toBe('你好，世界');
    expect(parser.getCurrentText()).toBe('你好，世界');
  });

  it('Delta Encoding 模式：event: delta 与 JSON Pointer 增量累加', () => {
    const parser = new ChatGPTStreamParser();

    // Delta 1: append "Hello"
    const f1 = parser.parseEvent({
      event: 'delta',
      data: JSON.stringify({
        v: 'Hello',
        p: '/message/content/parts/0',
        o: 'append',
      }),
    });
    expect(f1?.text).toBe('Hello');

    // Delta 2: append " World"
    const f2 = parser.parseEvent({
      event: 'delta',
      data: JSON.stringify({
        v: ' World',
        p: '/message/content/parts/0',
        o: 'append',
      }),
    });
    expect(f2?.text).toBe('Hello World');
    expect(parser.getCurrentText()).toBe('Hello World');
  });

  it('遇到 [DONE] 正确标记完成', () => {
    const parser = new ChatGPTStreamParser();
    const res = parser.parseEvent({ data: '[DONE]' });
    expect(res?.isDone).toBe(true);
  });

  it('过滤非 assistant 角色（如 user 回显或 tool 节点）', () => {
    const parser = new ChatGPTStreamParser();
    const res = parser.parseEvent({
      data: JSON.stringify({
        message: {
          author: { role: 'user' },
          content: { parts: ['用户的提问'] },
        },
      }),
    });
    expect(res).toBeNull();
    expect(parser.getCurrentText()).toBe('');
  });
});
