import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';
import node from '@astrojs/node';
import { defineConfig } from 'astro/config';

// 開發環境使用 Node adapter，生產環境使用 Cloudflare adapter
// 這樣可以在開發時使用完整的 Node.js API（包括檔案系統操作）
const isDev = process.env.NODE_ENV !== 'production';

// https://astro.build/config
export default defineConfig({
  site: 'https://uep.unforgettableeternalproject.com',
  outDir: './dist',
  output: 'hybrid',
  adapter: isDev ? node({ mode: 'standalone' }) : cloudflare(),
  integrations: [
    // 這裡刻意不掛 @astrojs/mdx：全站沒有任何 .mdx，內容一律走 D1 API。
    // 掛著的代價是它會註冊 astro:jsx renderer，而 Astro 4 選 renderer 的方式
    // 是逐一呼叫每個 renderer 的 check——astro:jsx 的 check 直接把元件當普通
    // 函式呼叫（astro/dist/jsx/server.js），React 元件被這樣呼叫時 hook 取不到
    // dispatcher，於是每個 island 每次 SSR 都噴一次 "Invalid hook call"。
    // 錯誤被 catch 吞掉後才輪到 React renderer 正確渲染，功能無損但很吵。
    // 真要重新引入 MDX 的話，這個副作用會一起回來。
    react(),
    sitemap({
      filter: (page) => !page.includes('/admin'),
    }),
  ],
  prefetch: {
    prefetchAll: false,
    defaultStrategy: 'hover',
  },
  build: {
    format: 'directory',
  },
  vite: {
    server: {
      fs: {
        // 允許存取 monorepo 根目錄和 node_modules
        allow: ['..', '../..'],
      },
    },
  },
});
