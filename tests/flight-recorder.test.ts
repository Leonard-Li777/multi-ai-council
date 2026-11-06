import { describe, it, expect, beforeEach } from 'vitest';
import { flightRecorder } from '../lib/logger/flight-recorder';

describe('FlightRecorder 飞行记录仪', () => {
  beforeEach(async () => {
    await flightRecorder.clear();
  });

  it('能正确记录并检索事件', async () => {
    flightRecorder.info('ChatGPT', 'INPUT_FOUND', { selector: '#prompt-textarea' });
    flightRecorder.warn('Wenxin', 'SEND_TIMEOUT', { timeoutMs: 2500 });
    flightRecorder.error('Claude', 'NETWORK_ERR', { status: 502 });

    const logs = await flightRecorder.getLogs();
    expect(logs.length).toBe(3);
    expect(logs[0]!.source).toBe('ChatGPT');
    expect(logs[0]!.action).toBe('INPUT_FOUND');
    expect(logs[1]!.level).toBe('WARN');
    expect(logs[2]!.level).toBe('ERROR');
  });

  it('exportDiagnosticReport 能导出包含 Markdown 表格的诊断文本', async () => {
    flightRecorder.info('Qwen', 'TURN_CONTAINER_MATCHED', { textLen: 12500 });

    const report = await flightRecorder.exportDiagnosticReport();
    expect(report).toContain('### ✈️ Multi-AI Council 飞行记录仪诊断报告');
    expect(report).toContain('| Qwen | INFO | `TURN_CONTAINER_MATCHED` |');
    expect(report).toContain('12500');
  });
});
