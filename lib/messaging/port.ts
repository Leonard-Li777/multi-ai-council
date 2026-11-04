import type { ProviderStatus, ReviewJob, SupportedSite } from '../types/review-job';

export const SIDEPANEL_PORT_NAME = 'multi-ai-sidepanel-port';
export const CONTENT_PORT_NAME = 'multi-ai-content-port';

export type PortMessage =
  // 心跳
  | { type: 'PING' }
  | { type: 'PONG' }

  // Side Panel -> Background
  | { type: 'START_JOB'; payload: { job: ReviewJob } }
  | { type: 'CANCEL_JOB'; payload: { jobId: string } }
  | { type: 'FOCUS_TAB'; payload: { siteName: SupportedSite } }
  | { type: 'RETRY_SITE'; payload: { siteName: SupportedSite } }
  | { type: 'SKIP_SITE'; payload: { jobId?: string; siteName: SupportedSite; reason?: string } }
  | { type: 'FAST_FORWARD_QUORUM'; payload: { jobId: string } }

  // Background -> Side Panel
  | { type: 'JOB_SYNC'; payload: { job: ReviewJob } }
  | { type: 'TAB_CLOSED'; payload: { siteName: SupportedSite; tabId: number } }

  // Content Script -> Background / Side Panel
  | { type: 'CONTENT_READY'; payload: { siteName: SupportedSite; url: string } }
  | {
      type: 'STREAM_UPDATE';
      payload: {
        siteName: SupportedSite;
        jobId: string;
        snapshot: string;
        cleaned: string;
        isFinished: boolean;
      };
    }
  | {
      type: 'STATUS_CHANGE';
      payload: {
        siteName: SupportedSite;
        jobId: string;
        status: ProviderStatus;
        errorReason?: string;
        conversationUrl?: string;
      };
    }
  | {
      type: 'UPDATE_CONVERSATION_URL';
      payload: {
        siteName: SupportedSite;
        jobId?: string;
        conversationUrl: string;
      };
    }

  // Background -> Content Script
  | {
      type: 'DISPATCH_PROMPT';
      payload: {
        jobId: string;
        prompt: string;
        isContinuation: boolean;
        siteName: SupportedSite;
      };
    };

/**
 * 建立长连接并带自动心跳机制
 */
export function setupPortWithHeartbeat(
  portName: string,
  onMessage: (msg: PortMessage) => void,
  onDisconnect?: () => void
): { port: chrome.runtime.Port; send: (msg: PortMessage) => void } {
  const port = chrome.runtime.connect({ name: portName });

  const interval = setInterval(() => {
    try {
      port.postMessage({ type: 'PING' });
    } catch {
      clearInterval(interval);
    }
  }, 10000); // 10s 心跳防止 SW 被意外休眠中断

  port.onMessage.addListener((msg: PortMessage) => {
    if (msg.type === 'PING') {
      port.postMessage({ type: 'PONG' });
      return;
    }
    if (msg.type === 'PONG') {
      return;
    }
    onMessage(msg);
  });

  port.onDisconnect.addListener(() => {
    clearInterval(interval);
    if (onDisconnect) onDisconnect();
  });

  return {
    port,
    send: (msg: PortMessage) => {
      try {
        port.postMessage(msg);
      } catch (err) {
        console.warn(`[Port ${portName}] send failed`, err);
      }
    },
  };
}
