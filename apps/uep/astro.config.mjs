import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
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
  integrations: [mdx(), react()],
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
    optimizeDeps: {
      // 排除 API 路徑，避免 Vite 嘗試優化它們
      exclude: ['/api/*'],
    },
    resolve: {
      // 防止 Vite 將 API 路徑解析為模組
      alias: {
        '/api': false,
      },
    },
  },
});

