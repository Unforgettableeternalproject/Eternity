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
];

// Keystatic 只在開發環境使用（避免 Workers runtime 不兼容）
if (process.env.NODE_ENV === 'development') {
  integrations.push(keystatic());
}

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
