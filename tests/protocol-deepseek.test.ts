import { describe, it, expect } from 'vitest';
import { DeepSeekStreamParser } from '../lib/parsers/deepseek-parser';

describe('AC4: DeepSeek R1 思考过程与正文管道分离解析', () => {
  it('正确提取 delta.reasoning_content 作为思考流，不混入正文缓冲区', () => {
    const parser = new DeepSeekStreamParser();

    // 思考帧 1
    const f1 = parser.parseEvent({
      data: JSON.stringify({
        choices: [
          {
            delta: { reasoning_content: '正在分析问题...' },
          },
        ],
      }),
    });
    expect(f1?.kind).toBe('THINKING');
    expect(f1?.text).toBe('正在分析问题...');
    expect(parser.getReasoningText()).toBe('正在分析问题...');
    expect(parser.getContentText()).toBe('');

    // 思考帧 2
    const f2 = parser.parseEvent({
      data: JSON.stringify({
        choices: [
          {
            delta: { reasoning_content: '寻找最优解法。' },
          },
        ],
      }),
    });
    expect(f2?.kind).toBe('THINKING');
    expect(parser.getReasoningText()).toBe('正在分析问题...寻找最优解法。');
    expect(parser.getContentText()).toBe('');
  });

  it('从思考阶段平滑过渡到正文阶段 (delta.content)，思考流完整保留', () => {
    const parser = new DeepSeekStreamParser();

    // 思考阶段
    parser.parseEvent({
      data: JSON.stringify({
        choices: [{ delta: { reasoning_content: '思考完成。' } }],
      }),
    });

    // 正文帧 1
    const c1 = parser.parseEvent({
      data: JSON.stringify({
        choices: [{ delta: { content: '这是' } }],
      }),
    });
    expect(c1?.kind).toBe('CONTENT');
    expect(c1?.text).toBe('这是');
    expect(parser.getContentText()).toBe('这是');

    // 正文帧 2
    const c2 = parser.parseEvent({
      data: JSON.stringify({
        choices: [{ delta: { content: '最终答案。' } }],
      }),
    });
    expect(c2?.kind).toBe('CONTENT');
    expect(parser.getContentText()).toBe('这是最终答案。');
    expect(parser.getReasoningText()).toBe('思考完成。');
  });

  it('遇到 finish_reason 标记完成', () => {
    const parser = new DeepSeekStreamParser();
    const doneFrame = parser.parseEvent({
      data: JSON.stringify({
        choices: [{ finish_reason: 'stop', delta: {} }],
      }),
    });
    expect(doneFrame?.isDone).toBe(true);
  });
});
