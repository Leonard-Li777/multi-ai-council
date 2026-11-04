import { defineBackground } from 'wxt/utils/define-background';
import {
  CONTENT_PORT_NAME,
  SIDEPANEL_PORT_NAME,
  type PortMessage,
} from '../lib/messaging/port';
import {
  getActiveJob,
  saveActiveJob,
  updateProviderRun,
  saveConversationRef,
  getConversationRef,
} from '../lib/storage/job-store';
import type { ReviewJob, SupportedSite, ProviderConversationRef } from '../lib/types/review-job';
import { extractConversationId, getTargetDispatchUrl } from '../lib/utils/conversation-helper';

export default defineBackground(() => {
  console.log('[Multi-AI Council] Background Service Worker initialized');

  // 配置点击扩展图标直接打开 Side Panel
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err: unknown) => {
      console.warn('[Background] Failed to set sidePanel behavior', err);
    });
  }

  // 端口连接池
  let sidePanelPort: chrome.runtime.Port | null = null;
  const contentPorts = new Map<SupportedSite, chrome.runtime.Port>();
  const siteTabs = new Map<SupportedSite, number>();

  chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
    if (port.name === SIDEPANEL_PORT_NAME) {
      sidePanelPort = port;
      console.log('[Background] Side Panel Port connected');

      port.onMessage.addListener(async (msg: PortMessage) => {
        if (msg.type === 'START_JOB') {
          await handleStartJob(msg.payload.job);
        } else if (msg.type === 'FOCUS_TAB') {
          let tabId = siteTabs.get(msg.payload.siteName);
          if (!tabId) {
            const activeJob = await getActiveJob();
            tabId = activeJob?.providerRuns[msg.payload.siteName]?.tabId;
          }
          if (!tabId) {
            const tabs = await chrome.tabs.query({ url: '*://chat.deepseek.com/*' });
            if (tabs.length > 0 && tabs[0]?.id) {
              tabId = tabs[0].id;
              siteTabs.set(msg.payload.siteName, tabId);
            }
          }
          if (tabId) {
            chrome.tabs.update(tabId, { active: true });
          }
        } else if (msg.type === 'RETRY_SITE') {
          const activeJob = await getActiveJob();
          if (activeJob) {
            await dispatchToSite(msg.payload.siteName, activeJob.id, activeJob.originalPrompt, activeJob.isContinuation);
          }
        }
      });

      port.onDisconnect.addListener(() => {
        sidePanelPort = null;
        console.log('[Background] Side Panel Port disconnected');
      });
    }

    if (port.name === CONTENT_PORT_NAME) {
      let registeredSite: SupportedSite | null = null;

      port.onMessage.addListener(async (msg: PortMessage) => {
        if (msg.type === 'CONTENT_READY') {
          registeredSite = msg.payload.siteName;
          contentPorts.set(registeredSite, port);
          console.log(`[Background] Content Script ready for ${registeredSite}`);

          // 若当前有正处于 WAITING_READY 的任务，立即下发
          const activeJob = await getActiveJob();
          if (
            activeJob &&
            activeJob.providerRuns[registeredSite]?.status === 'WAITING_READY'
          ) {
            await dispatchToSite(
              registeredSite,
              activeJob.id,
              activeJob.originalPrompt,
              activeJob.isContinuation
            );
          }
        } else if (msg.type === 'STATUS_CHANGE') {
          const { siteName, jobId, status, errorReason, conversationUrl } = msg.payload;

          let convRef: ProviderConversationRef | undefined = undefined;
          if (conversationUrl) {
            const convId = extractConversationId(conversationUrl);
            convRef = {
              siteName,
              conversationUrl,
              conversationId: convId || undefined,
              lastUpdatedAt: Date.now(),
            };
            await saveConversationRef(convRef);
          }

          const updated = await updateProviderRun(jobId, siteName, {
            status,
            errorReason,
            completedAt: status === 'DONE' ? Date.now() : undefined,
            conversationRef: convRef,
          });

          if (updated && sidePanelPort) {
            sidePanelPort.postMessage({ type: 'JOB_SYNC', payload: { job: updated } });
          }
        } else if (msg.type === 'STREAM_UPDATE') {
          const { siteName, jobId, snapshot, cleaned, isFinished } = msg.payload;
          const updated = await updateProviderRun(jobId, siteName, {
            responseSnapshot: snapshot,
            cleanedResponse: cleaned,
            status: isFinished ? 'DONE' : 'STREAMING',
          });

          if (updated && sidePanelPort) {
            sidePanelPort.postMessage({ type: 'JOB_SYNC', payload: { job: updated } });
          }
        } else if (msg.type === 'UPDATE_CONVERSATION_URL') {
          const { siteName, jobId, conversationUrl } = msg.payload;
          const convId = extractConversationId(conversationUrl);
          const convRef: ProviderConversationRef = {
            siteName,
            conversationUrl,
            conversationId: convId || undefined,
            lastUpdatedAt: Date.now(),
          };
          await saveConversationRef(convRef);

          if (jobId) {
            const updated = await updateProviderRun(jobId, siteName, {
              conversationRef: convRef,
            });
            if (updated && sidePanelPort) {
              sidePanelPort.postMessage({ type: 'JOB_SYNC', payload: { job: updated } });
            }
          }
        }
      });

      port.onDisconnect.addListener(() => {
        if (registeredSite) {
          contentPorts.delete(registeredSite);
          console.log(`[Background] Content Script disconnected for ${registeredSite}`);
        }
      });
    }
  });

  // 监听标签页意外关闭
  chrome.tabs.onRemoved.addListener(async (tabId: number) => {
    for (const [site, id] of siteTabs.entries()) {
      if (id === tabId) {
        siteTabs.delete(site);
        const activeJob = await getActiveJob();
        if (activeJob) {
          const updated = await updateProviderRun(activeJob.id, site, {
            status: 'TAB_CLOSED',
            errorReason: '标签页被手动关闭',
          });
          if (updated && sidePanelPort) {
            sidePanelPort.postMessage({ type: 'JOB_SYNC', payload: { job: updated } });
            sidePanelPort.postMessage({
              type: 'TAB_CLOSED',
              payload: { siteName: site, tabId },
            });
          }
        }
        break;
      }
    }
  });

  async function handleStartJob(job: ReviewJob) {
    await saveActiveJob(job);
    if (sidePanelPort) {
      sidePanelPort.postMessage({ type: 'JOB_SYNC', payload: { job } });
    }

    // 针对启用的站点逐一调度（首版仅 DeepSeek）
    for (const siteName of job.aggregationPolicy.enabledSites) {
      if (siteName === 'DeepSeek') {
        await ensureSiteTabAndDispatch(siteName, job);
      }
    }
  }

  async function ensureSiteTabAndDispatch(siteName: SupportedSite, job: ReviewJob) {
    // 0. 读取历史会话引用并解析目标分发 URL
    const existingRef = await getConversationRef(siteName);
    const targetUrl = getTargetDispatchUrl(siteName, job.isContinuation, existingRef || undefined);

    // 1. 查找是否已有打开的 DeepSeek 标签
    const tabs = await chrome.tabs.query({ url: '*://chat.deepseek.com/*' });
    let targetTab: chrome.tabs.Tab | undefined;
    let isNavigating = false;

    if (tabs.length > 0 && tabs[0]?.id !== undefined) {
      targetTab = tabs[0];
      siteTabs.set(siteName, tabs[0].id);

      // 若需要开启新会话且当前留在旧会话 /s/... 路径，或者需要延续且不在对应会话 URL
      if (targetTab.url && targetTab.url !== targetUrl) {
        if (!job.isContinuation && targetTab.url !== 'https://chat.deepseek.com/') {
          isNavigating = true;
          contentPorts.delete(siteName); // 提前注销即将失效的旧页面 Port
          await chrome.tabs.update(targetTab.id, { url: targetUrl });
        } else if (job.isContinuation && existingRef?.conversationUrl && targetTab.url !== existingRef.conversationUrl) {
          isNavigating = true;
          contentPorts.delete(siteName); // 提前注销即将失效的旧页面 Port
          await chrome.tabs.update(targetTab.id, { url: targetUrl });
        }
      }
    } else {
      // 2. 创建新标签页（直接载入目标会话或新会话根路径）并归拢至 Tab Group
      isNavigating = true;
      targetTab = await chrome.tabs.create({
        url: targetUrl,
        active: false,
      });
      if (targetTab?.id) {
        siteTabs.set(siteName, targetTab.id);
        try {
          if (chrome.tabs.group) {
            const groupId = await chrome.tabs.group({ tabIds: [targetTab.id] });
            await chrome.tabGroups.update(groupId, {
              title: 'Multi-AI Council',
              color: 'blue',
            });
          }
        } catch (e) {
          console.warn('[Background] Tab Grouping skipped or unsupported', e);
        }
      }
    }

    // 3. 检查 Content Script 是否已就绪（若正在触发导航重载，必须等待新页面 CONTENT_READY）
    const port = !isNavigating ? contentPorts.get(siteName) : undefined;
    if (port) {
      await dispatchToSite(siteName, job.id, job.originalPrompt, job.isContinuation);
    } else {
      // 标记为 WAITING_READY，等 Content Script 发送 CONTENT_READY 时自动触发
      if (targetTab?.id) {
        await updateProviderRun(job.id, siteName, {
          tabId: targetTab.id,
          status: 'WAITING_READY',
        });
      }
      const updatedJob = await getActiveJob();
      if (updatedJob && sidePanelPort) {
        sidePanelPort.postMessage({ type: 'JOB_SYNC', payload: { job: updatedJob } });
      }
    }
  }

  async function dispatchToSite(
    siteName: SupportedSite,
    jobId: string,
    prompt: string,
    isContinuation: boolean
  ) {
    const port = contentPorts.get(siteName);
    if (port) {
      port.postMessage({
        type: 'DISPATCH_PROMPT',
        payload: {
          siteName,
          jobId,
          prompt,
          isContinuation,
        },
      });
    } else {
      console.warn(`[Background] Port for ${siteName} not found during dispatch`);
    }
  }
});
