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

  it('兼容 Web 端可能出现的 delta.text、choice.text、json.content 等多样化字段', () => {
    const parser = new DeepSeekStreamParser();

    const f1 = parser.parseEvent({
      data: JSON.stringify({ choices: [{ delta: { text: '兼容字段1 ' } }] }),
    });
    expect(f1?.kind).toBe('CONTENT');
    expect(f1?.text).toBe('兼容字段1 ');

    const f2 = parser.parseEvent({
      data: JSON.stringify({ choices: [{ text: '兼容字段2 ' }] }),
    });
    expect(f2?.kind).toBe('CONTENT');
    expect(f2?.text).toBe('兼容字段2 ');

    const f3 = parser.parseEvent({
      data: JSON.stringify({ content: '兼容字段3' }),
    });
    expect(f3?.kind).toBe('CONTENT');
    expect(f3?.text).toBe('兼容字段3');

    expect(parser.getContentText()).toBe('兼容字段1 兼容字段2 兼容字段3');
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

  it('能精准识别 type: "thinking" 且文本在 delta.content 中的思维链切片，彻底阻断其进入正文', () => {
    const parser = new DeepSeekStreamParser();

    // 很多 Web 端 chunk 中将思考文本放在 delta.content，同时带有 type: 'thinking'
    const t1 = parser.parseEvent({
      data: JSON.stringify({
        choices: [
          {
            delta: { content: '第一阶段深度剖析...', type: 'thinking' },
          },
        ],
      }),
    });
    expect(t1?.kind).toBe('THINKING');
    expect(t1?.text).toBe('第一阶段深度剖析...');
    expect(parser.getReasoningText()).toBe('第一阶段深度剖析...');
    expect(parser.getContentText()).toBe('');

    // 正文切换：type 为 normal 或省略
    const c1 = parser.parseEvent({
      data: JSON.stringify({
        choices: [
          {
            delta: { content: '这是剥离思维链后的正式回答。' },
          },
        ],
      }),
    });
    expect(c1?.kind).toBe('CONTENT');
    expect(c1?.text).toBe('这是剥离思维链后的正式回答。');
    expect(parser.getContentText()).toBe('这是剥离思维链后的正式回答。');
    expect(parser.getReasoningText()).toBe('第一阶段深度剖析...');
  });

  it('能通过状态机跨 Chunk 过滤原生 <think>...</think> 标签，正文仅保留标签外内容', () => {
    const parser = new DeepSeekStreamParser();

    // Chunk 1: 开始思维链
    const p1 = parser.parseEvent({
      data: JSON.stringify({
        choices: [{ delta: { content: '<think>这是第一步思考' } }],
      }),
    });
    expect(p1?.kind).toBe('THINKING');
    expect(parser.getContentText()).toBe('');

    // Chunk 2: 思维链延续
    const p2 = parser.parseEvent({
      data: JSON.stringify({
        choices: [{ delta: { content: '，第二步推导。' } }],
      }),
    });
    expect(p2?.kind).toBe('THINKING');
    expect(parser.getContentText()).toBe('');

    // Chunk 3: 思考结束并立刻开启正式回答
    const p3 = parser.parseEvent({
      data: JSON.stringify({
        choices: [{ delta: { content: '</think>最终正式结论在这里。' } }],
      }),
    });
    expect(p3?.kind).toBe('CONTENT');
    expect(p3?.text).toBe('最终正式结论在这里。');
    expect(parser.getContentText()).toBe('最终正式结论在这里。');
    expect(parser.getReasoningText()).toContain('这是第一步思考，第二步推导。');
  });
});
