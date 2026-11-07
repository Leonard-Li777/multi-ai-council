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

  it('exportDiagnosticReport 能导出包含 Markdown 表格与全站点生命周期快照的诊断文本', async () => {
    flightRecorder.info('Qwen', 'TURN_CONTAINER_MATCHED', { textLen: 12500 });

    const report = await flightRecorder.exportDiagnosticReport();
    expect(report).toContain('### ✈️ Multi-AI Council 飞行记录仪诊断报告');
    expect(report).toContain('#### 📊 各站点最新生命周期快照');
    expect(report).toContain('| **DeepSeek** |');
    expect(report).toContain('| **ChatGPT** |');
    expect(report).toContain('| **Qwen** | `TURN_CONTAINER_MATCHED` |');
    expect(report).toContain('12500');
  });

  it('连续相同的事件能智能折叠并累加 repeatCount，防止单站点高频日志刷屏', async () => {
    // 连续写入 50 次完全相同的 TURN_CONTAINER_MATCHED 日志
    for (let i = 0; i < 50; i++) {
      flightRecorder.info('Qwen', 'TURN_CONTAINER_MATCHED', { textLen: 0 });
    }

    const logs = await flightRecorder.getLogs();
    // 应该只保留 1 条记录，且 repeatCount 为 50
    expect(logs.length).toBe(1);
    expect(logs[0]!.repeatCount).toBe(50);
    expect(logs[0]!.action).toBe('TURN_CONTAINER_MATCHED');

    // 再追加一条不同动作的日志
    flightRecorder.info('Qwen', 'DONE', { textLen: 500 });
    const updatedLogs = await flightRecorder.getLogs();
    expect(updatedLogs.length).toBe(2);
    expect(updatedLogs[1]!.repeatCount).toBe(1);
    expect(updatedLogs[1]!.action).toBe('DONE');
  });
});
