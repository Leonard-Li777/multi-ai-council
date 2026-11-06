import type { SSEEvent } from './sse-parser';

export interface AdapterParseResult {
  text: string;
  isDone: boolean;
  mode?: 'SNAPSHOT' | 'DELTA';
}

/**
 * 解析 Claude SSE 事件
 */
export function parseClaudeEvent(event: SSEEvent): AdapterParseResult | null {
  // 关键门卫：优先处理无 data 的控制事件 (如 message_stop)
  if (event.event === 'message_stop') {
    return { text: '', isDone: true, mode: 'DELTA' };
  }

  const rawData = event.data?.trim();
  if (!rawData) return null;

  if (rawData === '[DONE]') {
    return { text: '', isDone: true, mode: 'DELTA' };
  }

  try {
    const json = JSON.parse(rawData);
    if (json.type === 'message_stop') {
      return { text: '', isDone: true, mode: 'DELTA' };
    }

    if (json.delta && typeof json.delta.text === 'string') {
      return { text: json.delta.text, isDone: false, mode: 'DELTA' };
    }

    if (json.content_block && typeof json.content_block.text === 'string') {
      return { text: json.content_block.text, isDone: false, mode: 'DELTA' };
    }
  } catch {
    // 忽略异常
  }
  return null;
}

/**
 * 解析通义千问 SSE 事件 (智能自适应快照与增量模式)
 */
export function parseQwenEvent(event: SSEEvent): AdapterParseResult | null {
  const rawData = event.data?.trim();
  if (!rawData) return null;

  if (rawData === '[DONE]' || rawData === 'DONE') {
    return { text: '', isDone: true, mode: 'DELTA' };
  }

  try {
    const json = JSON.parse(rawData);

    // 网页端常见完成标记: is_end, status === 'finished', finish_reason
    const isDone = Boolean(
      json.is_end ||
      json.output?.finish_reason ||
      json.status === 'finished' ||
      json.choices?.[0]?.finish_reason
    );

    // 提取正文文本 (广泛兼容 output.text / content / delta / choices)
    let text = '';
    let mode: 'SNAPSHOT' | 'DELTA' = 'DELTA';

    if (json.output && typeof json.output.text === 'string') {
      text = json.output.text;
      // 仅当明确有 DashScope output 结构时按快照处理
      mode = 'SNAPSHOT';
    } else if (typeof json.content === 'string') {
      text = json.content;
      mode = 'DELTA';
    } else if (typeof json.text === 'string') {
      text = json.text;
      mode = 'DELTA';
    } else if (json.choices?.[0]) {
      const choice = json.choices[0];
      text = choice.delta?.content || choice.text || '';
      mode = 'DELTA';
    }

    if (text || isDone) {
      return {
        text,
        isDone,
        mode,
      };
    }
  } catch {
    // 忽略异常
  }
  return null;
}

/**
 * 解析百度文心一言 Chunked JSON
 */
export function parseWenxinChunk(rawChunk: string): AdapterParseResult | null {
  if (!rawChunk) return null;
  const trimmed = rawChunk.trim();

  try {
    const json = JSON.parse(trimmed);
    const text = typeof json.result === 'string' ? json.result : '';
    const isDone = Boolean(json.is_end);
    return { text, isDone, mode: 'DELTA' };
  } catch {
    // 容错处理
  }
  return null;
}
