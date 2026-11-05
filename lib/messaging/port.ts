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
  | { type: 'OPEN_SITES'; payload: { sites: SupportedSite[] } }
  | { type: 'RETRY_SITE'; payload: { siteName: SupportedSite } }
  | { type: 'SKIP_SITE'; payload: { jobId?: string; siteName: SupportedSite; reason?: string } }
  | { type: 'FAST_FORWARD_QUORUM'; payload: { jobId: string } }
  | { type: 'TRIGGER_SYNTHESIS'; payload: { jobId: string } }
  | { type: 'EXTEND_TIMEOUT'; payload: { jobId: string; extraSeconds: number } }

  // Background -> Side Panel
  | { type: 'JOB_SYNC'; payload: { job: ReviewJob } }
  | { type: 'TAB_CLOSED'; payload: { siteName: SupportedSite; tabId: number } }

  // Content Script -> Background / Side Panel
  | { type: 'CONTENT_READY'; payload: { siteName: SupportedSite; url: string; tabId?: number } }
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
      type: 'SYNTHESIS_STREAM_UPDATE';
      payload: {
        jobId: string;
        snapshot: string;
        isFinished: boolean;
      };
    }
  | {
      type: 'SYNTHESIS_STATUS_CHANGE';
      payload: {
        jobId: string;
        status: ProviderStatus;
        finalMarkdown?: string;
        errorReason?: string;
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
    }
  | {
      type: 'DISPATCH_SYNTHESIS_PROMPT';
      payload: {
        jobId: string;
        metaPrompt: string;
      };
    };

/**
 * 向 Background 统一发送控制消息（优先 sendMessage 唤醒 SW）
 */
export async function sendToBackground(msg: PortMessage): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      await chrome.runtime.sendMessage(msg);
    }
  } catch (err) {
    console.warn('[Messaging] chrome.runtime.sendMessage fallback warning:', err);
  }
}

/**
 * 建立长连接并带自动心跳机制与断线重连保障
 */
export function setupPortWithHeartbeat(
  portName: string,
  onMessage: (msg: PortMessage) => void,
  onDisconnect?: () => void,
  onConnect?: (send: (msg: PortMessage) => void) => void
): { port: chrome.runtime.Port; send: (msg: PortMessage) => void } {
  let activePort: chrome.runtime.Port | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let isUnmounted = false;

  const send = (msg: PortMessage) => {
    // 1. 尝试通过当前活跃 Port 发送
    if (activePort) {
      try {
        activePort.postMessage(msg);
      } catch (err) {
        console.warn(`[Port ${portName}] postMessage failed, trying fallback`, err);
      }
    }
    // 2. 双保险：派发 runtime.sendMessage 确保即使 Port 断开也能唤醒 Service Worker
    sendToBackground(msg);
  };

  function connect() {
    if (isUnmounted) return;
    try {
      activePort = chrome.runtime.connect({ name: portName });

      if (interval) clearInterval(interval);
      interval = setInterval(() => {
        try {
          activePort?.postMessage({ type: 'PING' });
        } catch {
          if (interval) clearInterval(interval);
        }
      }, 10000); // 10s 心跳防止 SW 被意外休眠中断

      activePort.onMessage.addListener((msg: PortMessage) => {
        if (msg.type === 'PING') {
          activePort?.postMessage({ type: 'PONG' });
          return;
        }
        if (msg.type === 'PONG') {
          return;
        }
        onMessage(msg);
      });

      if (onConnect) {
        onConnect(send);
      }

      activePort.onDisconnect.addListener(() => {
        if (interval) clearInterval(interval);
        if (onDisconnect) onDisconnect();
        activePort = null;
        // 若非主动注销，断线后 1.5s 自动重连
        if (!isUnmounted) {
          setTimeout(connect, 1500);
        }
      });
    } catch (err) {
      console.warn(`[Port ${portName}] Connect error:`, err);
      if (!isUnmounted) {
        setTimeout(connect, 2000);
      }
    }
  }

  connect();

  return {
    get port() {
      return activePort!;
    },
    send,
  };
}
