import { defineContentScript } from 'wxt/utils/define-content-script';
import { setupNetworkProxy } from '../lib/interceptor/network-proxy';

/**
 * Multi-AI Council 透明网络旁路分流器 (MAIN World)
 * 遵循 WXT 规范注入目标页面顶层全局环境 (world: 'MAIN', runAt: 'document_start')
 * 绕过宿主 CSP 并直接截获原生 Fetch / XHR 流式报文
 */
export default defineContentScript({
  matches: [
    'https://chatgpt.com/*',
    'https://chat.deepseek.com/*',
    'https://claude.ai/*',
    'https://chat.qwen.ai/*',
    'https://yiyan.baidu.com/*',
    'https://wenxin.baidu.com/*',
    'https://gemini.google.com/*',
    'https://chatglm.cn/*',
  ],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    setupNetworkProxy();
  },
});
