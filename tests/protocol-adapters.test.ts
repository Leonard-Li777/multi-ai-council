import { describe, it, expect } from 'vitest';
import {
  parseClaudeEvent,
  parseQwenEvent,
  parseWenxinChunk,
} from '../lib/parsers/protocol-adapters';

describe('Claude / Qwen / Wenxin 协议适配纯函数', () => {
  describe('Claude', () => {
    it('提取 content_block_delta 中的 text 增量', () => {
      const res = parseClaudeEvent({
        event: 'content_block_delta',
        data: JSON.stringify({
          delta: { type: 'text_delta', text: 'Claude 回复' },
        }),
      });
      expect(res?.text).toBe('Claude 回复');
      expect(res?.isDone).toBe(false);
    });

    it('遇到 message_stop 标记完成 (无论是否包含 data)', () => {
      const res = parseClaudeEvent({
        event: 'message_stop',
        data: '',
      });
      expect(res?.isDone).toBe(true);
    });
  });

  describe('Qwen', () => {
    it('提取 output.text 全量快照模式并标记 mode: SNAPSHOT', () => {
      const deltaRes = parseQwenEvent({
        data: JSON.stringify({
          output: { text: '千问回答' },
        }),
      });
      expect(deltaRes?.text).toBe('千问回答');
      expect(deltaRes?.mode).toBe('SNAPSHOT');
    });

    it('兼容 choices[0].delta.content 格式并标记 mode: DELTA', () => {
      const deltaRes = parseQwenEvent({
        data: JSON.stringify({
          choices: [{ delta: { content: 'token' } }],
        }),
      });
      expect(deltaRes?.text).toBe('token');
      expect(deltaRes?.mode).toBe('DELTA');
    });
  });

  describe('Wenxin', () => {
    it('提取 JSON chunk 中的 result 字段并识别 is_end: true', () => {
      const chunk1 = parseWenxinChunk('{"result":"百度文心","is_end":false}');
      expect(chunk1?.text).toBe('百度文心');
      expect(chunk1?.isDone).toBe(false);

      const chunk2 = parseWenxinChunk('{"result":"结束","is_end":true}');
      expect(chunk2?.text).toBe('结束');
      expect(chunk2?.isDone).toBe(true);
    });
  });
});
