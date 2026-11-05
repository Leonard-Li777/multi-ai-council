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
  batchUpdateProviderRuns,
  saveConversationRef,
  getConversationRef,
  updateSynthesisRun,
} from '../lib/storage/job-store';
import type { ReviewJob, SupportedSite, ProviderConversationRef, ProviderRun } from '../lib/types/review-job';
import {
  extractConversationId,
  getTargetDispatchUrl,
  SITE_BASE_URLS,
} from '../lib/utils/conversation-helper';
import { buildAnonymizedSynthesisPrompt } from '../lib/utils/synthesis-builder';
import { calculateQuorumProgress } from '../lib/utils/quorum-calculator';

const SITE_QUERY_PATTERNS: Record<SupportedSite, string[]> = {
  DeepSeek: ['https://chat.deepseek.com/*'],
  ChatGPT: ['https://chatgpt.com/*'],
  Claude: ['https://claude.ai/*'],
  Gemini: ['https://gemini.google.com/*'],
  Qwen: ['https://chat.qwen.ai/*'],
  Wenxin: ['https://yiyan.baidu.com/*', 'https://wenxin.baidu.com/*'],
  ChatGLM: ['https://chatglm.cn/*'],
};

const SITE_CONTENT_SCRIPTS: Record<SupportedSite, string> = {
  DeepSeek: 'content-scripts/deepseek.js',
  ChatGPT: 'content-scripts/chatgpt.js',
  Claude: 'content-scripts/claude.js',
  Gemini: 'content-scripts/gemini.js',
  Qwen: 'content-scripts/qwen.js',
  Wenxin: 'content-scripts/wenxin.js',
  ChatGLM: 'content-scripts/chatglm.js',
};

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
  let synthesisTabId: number | null = null;
  let synthesisPort: chrome.runtime.Port | null = null;
  let pendingSynthesisMetaPrompt: { jobId: string; metaPrompt: string } | null = null;

  // 广播状态更新至 Side Panel（双通道：Port + runtime.sendMessage）
  function broadcastJobSync(job: ReviewJob | null) {
    if (!job) return;
    if (sidePanelPort) {
      try {
        sidePanelPort.postMessage({ type: 'JOB_SYNC', payload: { job } });
      } catch (err) {
        console.warn('[Background] broadcastJobSync via port failed', err);
      }
    }
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'JOB_SYNC', payload: { job } }).catch(() => {});
      }
    } catch {
      // ignore
    }
  }

  // 统一处理 Content Script 上报的消息（支持 Port 与 runtime.onMessage）
  async function handleContentScriptMessage(msg: PortMessage, port?: chrome.runtime.Port) {
    if (msg.type === 'CONTENT_READY') {
      const senderTabId = port?.sender?.tab?.id;
      const isSynthesisTab = senderTabId !== undefined && senderTabId === synthesisTabId;

      if (isSynthesisTab || (synthesisTabId && senderTabId === synthesisTabId)) {
        console.log('[Background] Synthesis DeepSeek Tab ready');
        if (port) synthesisPort = port;
        if (pendingSynthesisMetaPrompt) {
          if (synthesisPort) {
            try {
              synthesisPort.postMessage({
                type: 'DISPATCH_SYNTHESIS_PROMPT',
                payload: pendingSynthesisMetaPrompt,
              });
            } catch {}
          }
          if (synthesisTabId) {
            chrome.tabs.sendMessage(synthesisTabId, {
              type: 'DISPATCH_SYNTHESIS_PROMPT',
              payload: pendingSynthesisMetaPrompt,
            }).catch(() => {});
          }
          pendingSynthesisMetaPrompt = null;
        }
        return;
      }

      const siteName = msg.payload.siteName;
      if (port) {
        contentPorts.set(siteName, port);
      }
      const tabId = port?.sender?.tab?.id || msg.payload.tabId;
      if (tabId) {
        siteTabs.set(siteName, tabId);
      }
      console.log(`[Background] Content Script ready for ${siteName}`);

      // 若当前有正处于 WAITING_READY 的任务，立即下发
      const activeJob = await getActiveJob();
      if (
        activeJob &&
        activeJob.providerRuns[siteName]?.status === 'WAITING_READY'
      ) {
        await dispatchToSite(
          siteName,
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

      broadcastJobSync(updated);

      if (status === 'DONE' || status === 'FAILED' || status === 'TIMEOUT') {
        await checkAutoTriggerSynthesis(jobId);
      }
    } else if (msg.type === 'STREAM_UPDATE') {
      const { siteName, jobId, snapshot, cleaned, isFinished } = msg.payload;
      const updated = await updateProviderRun(jobId, siteName, {
        responseSnapshot: snapshot,
        cleanedResponse: cleaned,
        status: isFinished ? 'DONE' : 'STREAMING',
      });

      broadcastJobSync(updated);

      if (isFinished) {
        await checkAutoTriggerSynthesis(jobId);
      }
    } else if (msg.type === 'SYNTHESIS_STREAM_UPDATE') {
      const { jobId, snapshot, isFinished } = msg.payload;
      const updated = await updateSynthesisRun(jobId, {
        status: isFinished ? 'DONE' : 'STREAMING',
        finalMarkdown: snapshot,
      });
      broadcastJobSync(updated);
    } else if (msg.type === 'SYNTHESIS_STATUS_CHANGE') {
      const { jobId, status, finalMarkdown, errorReason } = msg.payload;
      const updated = await updateSynthesisRun(jobId, {
        status,
        finalMarkdown,
      });
      broadcastJobSync(updated);
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
        broadcastJobSync(updated);
      }
    }
  }

  // 统一指令消息处理路由（同时服务于 Port 与 chrome.runtime.onMessage）
  async function handleIncomingControlMessage(msg: PortMessage, port?: chrome.runtime.Port) {
    console.log('[Background] Received message:', msg.type);

    if (msg.type === 'START_JOB') {
      await handleStartJob(msg.payload.job);
    } else if (msg.type === 'FOCUS_TAB') {
      let tabId = siteTabs.get(msg.payload.siteName);
      if (!tabId) {
        const activeJob = await getActiveJob();
        tabId = activeJob?.providerRuns[msg.payload.siteName]?.tabId;
      }
      if (!tabId) {
        const queryPatterns = SITE_QUERY_PATTERNS[msg.payload.siteName] || ['https://chat.deepseek.com/*'];
        try {
          const tabs = await chrome.tabs.query({ url: queryPatterns });
          if (tabs.length > 0 && tabs[0]?.id) {
            tabId = tabs[0].id;
            siteTabs.set(msg.payload.siteName, tabId);
          }
        } catch (e) {
          console.warn('[Background] FOCUS_TAB query error', e);
        }
      }
      // 若标签页不存在，主动创建并聚焦，方便用户登录
      if (!tabId) {
        const url = SITE_BASE_URLS[msg.payload.siteName] || 'https://chat.deepseek.com/';
        try {
          const newTab = await chrome.tabs.create({ url, active: true });
          if (newTab?.id) {
            tabId = newTab.id;
            siteTabs.set(msg.payload.siteName, tabId);
          }
        } catch (e) {
          console.warn('[Background] FOCUS_TAB create error', e);
        }
      }
      if (tabId) {
        chrome.tabs.update(tabId, { active: true }, (tab) => {
          if (tab?.windowId) {
            chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
          }
        });
      }
    } else if (msg.type === 'OPEN_SITES') {
      // 批量打开指定站点供用户预先登录
      const openedTabIds: number[] = [];
      for (const siteName of msg.payload.sites) {
        let tabId = siteTabs.get(siteName);
        if (!tabId) {
          const queryPatterns = SITE_QUERY_PATTERNS[siteName] || ['https://chat.deepseek.com/*'];
          try {
            const tabs = await chrome.tabs.query({ url: queryPatterns });
            if (tabs.length > 0 && tabs[0]?.id) {
              tabId = tabs[0].id;
              siteTabs.set(siteName, tabId);
            }
          } catch {}
        }
        if (!tabId) {
          const url = SITE_BASE_URLS[siteName] || 'https://chat.deepseek.com/';
          try {
            const newTab = await chrome.tabs.create({ url, active: false });
            if (newTab?.id) {
              tabId = newTab.id;
              siteTabs.set(siteName, tabId);
            }
          } catch {}
        }
        if (tabId) {
          openedTabIds.push(tabId);
          ensureContentScriptReady(tabId, siteName).catch(() => {});
        }
      }
      if (openedTabIds.length > 0) {
        try {
          if (chrome.tabs.group) {
            const firstId = openedTabIds[0]!;
            const groupId = (await chrome.tabs.group({
              tabIds: [firstId, ...openedTabIds.slice(1)],
            })) as unknown as number;
            if (typeof groupId === 'number') {
              await chrome.tabGroups.update(groupId, {
                title: 'Multi-AI Council',
                color: 'blue',
              });
            }
          }
        } catch {}
        chrome.tabs.update(openedTabIds[0]!, { active: true });
      }
    } else if (msg.type === 'RETRY_SITE') {
      const activeJob = await getActiveJob();
      if (activeJob) {
        const siteName = msg.payload.siteName;
        console.log(`[Background] RETRY_SITE requested for ${siteName}, attempting smart recovery...`);

        // 1. 先尝试向已打开的 Content Script 派发 RECOVER_SITE 执行就地自愈
        let recovered = false;
        const port = contentPorts.get(siteName);
        if (port) {
          try {
            port.postMessage({
              type: 'RECOVER_SITE',
              payload: { siteName, jobId: activeJob.id, prompt: activeJob.originalPrompt },
            });
            recovered = true;
          } catch {}
        }

        const tabId = siteTabs.get(siteName);
        if (!recovered && tabId) {
          try {
            const res = await chrome.tabs.sendMessage(tabId, {
              type: 'RECOVER_SITE',
              payload: { siteName, jobId: activeJob.id, prompt: activeJob.originalPrompt },
            });
            if (res && (res.received || res.success)) {
              recovered = true;
            }
          } catch {}
        }

        // 2. 若当前标签页无法就地自愈，降级为重新调度该站
        if (!recovered) {
          const updated = await updateProviderRun(activeJob.id, siteName, {
            status: 'WAITING_READY',
            errorReason: undefined,
          });
          broadcastJobSync(updated);
          await ensureSiteTabAndDispatch(siteName, activeJob);
        }
      }
    } else if (msg.type === 'EXTEND_TIMEOUT') {
      const activeJob = await getActiveJob();
      if (activeJob && activeJob.id === msg.payload.jobId) {
        activeJob.deadlineAt = Date.now() + (msg.payload.extraSeconds || 90) * 1000;
        await saveActiveJob(activeJob);
        broadcastJobSync(activeJob);
      }
    } else if (msg.type === 'SKIP_SITE') {
      const activeJob = await getActiveJob();
      if (activeJob && (!msg.payload.jobId || activeJob.id === msg.payload.jobId)) {
        contentPorts.delete(msg.payload.siteName);
        const updated = await updateProviderRun(activeJob.id, msg.payload.siteName, {
          status: 'CANCELED',
          errorReason: msg.payload.reason || '用户手动跳过等待',
          completedAt: Date.now(),
        });
        broadcastJobSync(updated);
        await checkAutoTriggerSynthesis(activeJob.id);
      }
    } else if (msg.type === 'TRIGGER_SYNTHESIS') {
      await triggerSynthesis(msg.payload.jobId);
    } else if (msg.type === 'FAST_FORWARD_QUORUM') {
      const activeJob = await getActiveJob();
      if (activeJob && activeJob.id === msg.payload.jobId) {
        const batchUpdates: Partial<Record<SupportedSite, Partial<ProviderRun>>> = {};
        for (const [site, run] of Object.entries(activeJob.providerRuns)) {
          if (
            run.status === 'PENDING' ||
            run.status === 'OPENING_TAB' ||
            run.status === 'WAITING_READY' ||
            run.status === 'SENDING' ||
            run.status === 'STREAMING'
          ) {
            contentPorts.delete(site as SupportedSite);
            batchUpdates[site as SupportedSite] = {
              status: 'CANCELED',
              errorReason: '提前降级终审跳过',
              completedAt: Date.now(),
            };
          }
        }
        const updated = await batchUpdateProviderRuns(activeJob.id, batchUpdates);
        broadcastJobSync(updated);
        await triggerSynthesis(activeJob.id);
      }
    } else {
      // 转发处理来自 Content Script 的消息
      await handleContentScriptMessage(msg, port);
    }
  }

  // 1. 注册 runtime.onMessage 监听（保障 SW 唤醒后的首要指令畅通）
  chrome.runtime.onMessage.addListener((msg: PortMessage, sender, sendResponse) => {
    if (msg.type === 'CONTENT_READY' && sender.tab?.id && !msg.payload.tabId) {
      msg.payload.tabId = sender.tab.id;
    }
    handleIncomingControlMessage(msg)
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        console.error('[Background] handleIncomingControlMessage error:', err);
        sendResponse({ success: false, error: String(err) });
      });
    return true; // 异步消息响应通道保活
  });

  // 2. 注册长连接 Port 监听
  chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
    if (port.name === SIDEPANEL_PORT_NAME) {
      sidePanelPort = port;
      console.log('[Background] Side Panel Port connected');

      port.onMessage.addListener(async (msg: PortMessage) => {
        await handleIncomingControlMessage(msg);
      });

      port.onDisconnect.addListener(() => {
        sidePanelPort = null;
        console.log('[Background] Side Panel Port disconnected');
      });
    }

    if (port.name === CONTENT_PORT_NAME) {
      let registeredSite: SupportedSite | null = null;
      const senderTabId = port.sender?.tab?.id;
      const isSynthesisTab = senderTabId !== undefined && senderTabId === synthesisTabId;

      if (isSynthesisTab) {
        synthesisPort = port;
        console.log('[Background] Synthesis DeepSeek Port connected');
      }

      port.onMessage.addListener(async (msg: PortMessage) => {
        if (msg.type === 'CONTENT_READY') {
          registeredSite = msg.payload.siteName;
        }
        await handleContentScriptMessage(msg, port);
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
    if (tabId === synthesisTabId) {
      synthesisTabId = null;
      synthesisPort = null;
      const activeJob = await getActiveJob();
      if (activeJob && activeJob.synthesisRun?.status === 'STREAMING') {
        const updated = await updateSynthesisRun(activeJob.id, {
          status: 'TAB_CLOSED',
        });
        broadcastJobSync(updated);
      }
    }

    for (const [site, id] of siteTabs.entries()) {
      if (id === tabId) {
        siteTabs.delete(site);
        const activeJob = await getActiveJob();
        if (activeJob) {
          const updated = await updateProviderRun(activeJob.id, site, {
            status: 'TAB_CLOSED',
            errorReason: '标签页被手动关闭',
          });
          broadcastJobSync(updated);
          if (sidePanelPort) {
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

  let startingJobId: string | null = null;
  async function handleStartJob(job: ReviewJob) {
    if (startingJobId === job.id) {
      console.log(`[Background] handleStartJob already running for job ${job.id}, skipping duplicate dispatch`);
      return;
    }
    startingJobId = job.id;
    console.log('[Background] handleStartJob started for job:', job.id);
    await saveActiveJob(job);
    broadcastJobSync(job);

    try {
      // 针对启用的所有站点并发错峰调度（单站独立超时保护，绝不让个别站点卡死其余站点）
      const dispatchPromises = job.aggregationPolicy.enabledSites.map(async (siteName, index) => {
        if (index > 0) {
          await new Promise((r) => setTimeout(r, index * 350));
        }

        try {
          // 单站调度增加 10 秒超时隔离保护
          await Promise.race([
            ensureSiteTabAndDispatch(siteName, job),
            new Promise((_, reject) => setTimeout(() => reject(new Error('标签页初始化准备超时(10s)')), 10000)),
          ]);
        } catch (err) {
          console.error(`[Background] Failed to dispatch to site ${siteName}:`, err);
          const updated = await updateProviderRun(job.id, siteName, {
            status: 'WAITING_READY',
            errorReason: `标签页加载中或超时: ${String(err)}`,
          });
          broadcastJobSync(updated);
        }
      });

      await Promise.allSettled(dispatchPromises);
    } finally {
      setTimeout(() => {
        if (startingJobId === job.id) startingJobId = null;
      }, 5000);
    }
  }

  async function ensureContentScriptReady(tabId: number, siteName: SupportedSite): Promise<boolean> {
    // 1. 优先尝试探测标签页内是否已有存活的 content script
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      if (res && res.ready) {
        return true;
      }
    } catch {
      // 尚未响应，尝试主动注入
    }

    // 2. 使用 chrome.scripting.executeScript 动态注入编译产物中的 content script
    const scriptFile = SITE_CONTENT_SCRIPTS[siteName];
    if (chrome.scripting && chrome.scripting.executeScript && scriptFile) {
      try {
        console.log(`[Background] Actively injecting ${scriptFile} into tab ${tabId} (${siteName})...`);
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [scriptFile],
        });
        // 留出 200ms 等待 content script 启动注册
        await new Promise((r) => setTimeout(r, 200));
        const pingRes = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
        if (pingRes && pingRes.ready) {
          console.log(`[Background] Successfully injected and confirmed ready: ${siteName}`);
          return true;
        }
      } catch (err) {
        console.warn(`[Background] executeScript attempt failed for ${siteName} tab ${tabId}:`, err);
      }
    }

    return false;
  }

  async function ensureSiteTabAndDispatch(siteName: SupportedSite, job: ReviewJob) {
    // 0. 读取历史会话引用并解析目标分发 URL
    const existingRef = await getConversationRef(siteName);
    const targetUrl = getTargetDispatchUrl(siteName, job.isContinuation, existingRef || undefined);
    const baseUrl = SITE_BASE_URLS[siteName] || 'https://chat.deepseek.com/';

    // 1. 查找是否已有打开的对应站点标签页（先检查 siteTabs 缓存，再查 query）
    let targetTab: chrome.tabs.Tab | undefined;
    let isNavigating = false;

    const cachedTabId = siteTabs.get(siteName);
    if (cachedTabId) {
      try {
        const tab = await chrome.tabs.get(cachedTabId);
        if (tab && !tab.discarded) {
          targetTab = tab;
        }
      } catch {
        siteTabs.delete(siteName);
      }
    }

    if (!targetTab) {
      const queryPatterns = SITE_QUERY_PATTERNS[siteName] || ['https://chat.deepseek.com/*'];
      let tabs: chrome.tabs.Tab[] = [];
      try {
        tabs = await chrome.tabs.query({ url: queryPatterns });
      } catch (e) {
        console.warn(`[Background] chrome.tabs.query failed for ${siteName}`, e);
      }

      if (tabs.length > 0 && tabs[0]?.id !== undefined) {
        targetTab = tabs[0];
        siteTabs.set(siteName, tabs[0].id);
      }
    }

    if (targetTab && targetTab.id !== undefined) {
      siteTabs.set(siteName, targetTab.id);

      // 若需要延续特定远程会话且不在对应会话 URL，才尝试导航
      if (job.isContinuation && existingRef?.conversationUrl && targetTab.url && targetTab.url !== existingRef.conversationUrl) {
        try {
          isNavigating = true;
          contentPorts.delete(siteName);
          await chrome.tabs.update(targetTab.id, { url: existingRef.conversationUrl });
        } catch (e) {
          isNavigating = false;
          console.warn(`[Background] Navigation to conversationUrl skipped/rejected:`, e);
        }
      } else if (!job.isContinuation && targetTab.url) {
        // 若明确为新会话，且复用的标签页正停留在历史会话详情页，主动导航回根路径开启全新空白对话
        const isHistoricalChatUrl =
          (siteName === 'DeepSeek' && targetTab.url.includes('/a/chat/s/')) ||
          (siteName === 'ChatGPT' && targetTab.url.includes('/c/')) ||
          (siteName === 'Claude' && targetTab.url.includes('/chat/')) ||
          (siteName === 'Qwen' && targetTab.url.includes('/c/'));

        if (isHistoricalChatUrl) {
          try {
            console.log(`[Background] Resetting ${siteName} tab ${targetTab.id} to new chat root: ${baseUrl}`);
            isNavigating = true;
            contentPorts.delete(siteName);
            await chrome.tabs.update(targetTab.id, { url: baseUrl });
          } catch (e) {
            isNavigating = false;
            console.warn(`[Background] Navigation to baseUrl skipped/rejected:`, e);
          }
        }
      }
    } else {
      // 2. 创建新标签页（直接载入目标会话或新会话根路径）并归拢至 Tab Group
      try {
        isNavigating = true;
        targetTab = await chrome.tabs.create({
          url: targetUrl,
          active: false,
        });
        if (targetTab?.id) {
          siteTabs.set(siteName, targetTab.id);
          if (chrome.tabs.group) {
            try {
              const groupId = (await chrome.tabs.group({ tabIds: [targetTab.id] })) as unknown as number;
              if (typeof groupId === 'number') {
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
      } catch (e) {
        console.warn('[Background] tabs.create error:', e);
      }
    }

    // 3. 检查并确保 Content Script 已就绪并注入
    let isReady = false;
    if (!isNavigating && targetTab?.id) {
      isReady = await ensureContentScriptReady(targetTab.id, siteName);
    }

    if (isReady) {
      await dispatchToSite(siteName, job.id, job.originalPrompt, job.isContinuation);
    } else {
      // 标记为 WAITING_READY，若标签页未响应则触发重载以强制由 Chrome 自动注入 content script
      if (targetTab?.id) {
        await updateProviderRun(job.id, siteName, {
          tabId: targetTab.id,
          status: 'WAITING_READY',
        });
        if (!isNavigating) {
          try {
            console.log(`[Background] Tab ${targetTab.id} not responding for ${siteName}, reloading to inject...`);
            await chrome.tabs.reload(targetTab.id);
          } catch {}
        }
      }
      const updatedJob = await getActiveJob();
      broadcastJobSync(updatedJob);
    }
  }

  async function dispatchToSite(
    siteName: SupportedSite,
    jobId: string,
    prompt: string,
    isContinuation: boolean
  ) {
    const port = contentPorts.get(siteName);
    let dispatched = false;

    if (port) {
      try {
        port.postMessage({
          type: 'DISPATCH_PROMPT',
          payload: {
            siteName,
            jobId,
            prompt,
            isContinuation,
          },
        });
        dispatched = true;
      } catch (e) {
        console.warn(`[Background] Port dispatch failed for ${siteName}, fallback to sendMessage`, e);
      }
    }

    const tabId = siteTabs.get(siteName);
    if (tabId) {
      try {
        const res = await chrome.tabs.sendMessage(tabId, {
          type: 'DISPATCH_PROMPT',
          payload: {
            siteName,
            jobId,
            prompt,
            isContinuation,
          },
        });
        if (res?.received || res?.success) {
          dispatched = true;
        }
      } catch {
        // Tab might still be initializing
      }
    }

    if (dispatched) {
      // 成功派发，状态立即推进为 SENDING，消除 UI 卡死在“等待就绪”
      const updated = await updateProviderRun(jobId, siteName, {
        status: 'SENDING',
      });
      broadcastJobSync(updated);
    } else {
      console.warn(`[Background] Could not dispatch to ${siteName} immediately, waiting for ready event`);
    }
  }

  async function checkAutoTriggerSynthesis(jobId: string) {
    const job = await getActiveJob();
    if (!job || job.id !== jobId) return;
    if (job.synthesisRun && job.synthesisRun.status !== 'PENDING') return;

    const quorum = calculateQuorumProgress(job);
    if (quorum.isAllSettled && quorum.completedCount >= quorum.minRequired) {
      await triggerSynthesis(job.id);
    }
  }

  async function triggerSynthesis(jobId: string) {
    const job = await getActiveJob();
    if (!job || job.id !== jobId) return;
    if (job.synthesisRun && job.synthesisRun.status === 'STREAMING') return;

    const runs = Object.values(job.providerRuns);
    const { metaPrompt, anonymousMap, participatingCount } = buildAnonymizedSynthesisPrompt(
      job.originalPrompt,
      runs
    );

    if (participatingCount === 0 || !metaPrompt) {
      console.warn('[Background] No completed provider runs available for synthesis');
      return;
    }

    console.log(`[Background] Triggering synthesis for Job ${jobId} with ${participatingCount} anonymous models`);

    pendingSynthesisMetaPrompt = { jobId, metaPrompt };

    // 1. 创建全新的 DeepSeek 标签页作为终审专用窗口并加入 Tab Group
    const targetTab = await chrome.tabs.create({
      url: 'https://chat.deepseek.com/',
      active: false,
    });

    if (targetTab?.id) {
      synthesisTabId = targetTab.id;
      try {
        if (chrome.tabs.group) {
          const groupId = await chrome.tabs.group({ tabIds: [targetTab.id] });
          await chrome.tabGroups.update(groupId, {
            title: 'Multi-AI Council',
            color: 'blue',
          });
        }
      } catch (e) {
        console.warn('[Background] Tab Grouping for synthesis tab skipped', e);
      }
    }

    const updated = await updateSynthesisRun(job.id, {
      tabId: targetTab?.id,
      status: 'WAITING_READY',
      anonymousMap,
      finalMarkdown: '',
    });

    if (updated && sidePanelPort) {
      sidePanelPort.postMessage({ type: 'JOB_SYNC', payload: { job: updated } });
    }
  }
});
