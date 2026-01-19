import markdoc from '@astrojs/markdoc';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';
import keystatic from '@keystatic/astro';
import { defineConfig } from 'astro/config';

// 只在開發環境載入 Keystatic
const integrations = [
  tailwind({
    applyBaseStyles: false, // 我們會自訂基礎樣式
  }),
  markdoc(),
  react(),
  // Keystatic 在所有環境都啟用 (使用 GitHub storage)
  // 需要明確指定配置檔案路徑
  keystatic({
    config: './keystatic.config.tsx',
  }),
];

// https://astro.build/config
export default defineConfig({
  site: 'https://unforgettableeternalproject.com',
  output: 'static',
  adapter: cloudflare(),
  outDir: './dist',
  build: {
    format: 'directory',
  },
  i18n: {
    defaultLocale: 'zh-tw',
    locales: ['zh-tw', 'en'],
    routing: {
      prefixDefaultLocale: false,
      strategy: 'pathname',
    },
  },
  vite: {
    optimizeDeps: {
      include: ['@keystatic/astro/ui'],
    },
    ssr: {
      noExternal: ['@keystatic/core', '@keystatic/astro'],
    },
  },
  integrations,
});
