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
 * 解析通义千问 SSE 事件 (显式区分 output.text 快照 与 delta 增量)
 */
export function parseQwenEvent(event: SSEEvent): AdapterParseResult | null {
  const rawData = event.data?.trim();
  if (!rawData) return null;

  if (rawData === '[DONE]') {
    return { text: '', isDone: true, mode: 'DELTA' };
  }

  try {
    const json = JSON.parse(rawData);

    // 格式 1: output.text (全量快照模式，严禁无脑累加)
    if (json.output && typeof json.output.text === 'string') {
      return {
        text: json.output.text,
        isDone: Boolean(json.output.finish_reason),
        mode: 'SNAPSHOT',
      };
    }

    // 格式 2: choices[0].delta.content (增量模式)
    const choice = json.choices?.[0];
    if (choice) {
      const isDone = Boolean(choice.finish_reason);
      const text = choice.delta?.content || choice.text || '';
      return {
        text,
        isDone,
        mode: 'DELTA',
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
