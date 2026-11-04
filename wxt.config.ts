import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'Multi-AI Council - 智能多模型协作工作台',
    description: '多 AI 会话分发、状态监听与可信终审聚合扩展',
    version: '0.1.0',
    permissions: [
      'sidePanel',
      'tabs',
      'tabGroups',
      'storage',
      'scripting',
    ],
    host_permissions: [
      'https://chat.deepseek.com/*',
      'https://chat.qwen.ai/*',
      'https://wenxin.baidu.com/*',
      'https://chatglm.cn/*',
      'https://chatgpt.com/*',
      'https://claude.ai/*',
      'https://gemini.google.com/*',
    ],
    action: {
      default_title: '打开 Multi-AI 侧边栏',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
  },
});
