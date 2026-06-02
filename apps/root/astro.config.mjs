import { readFileSync } from 'node:fs';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';
import { defineConfig } from 'astro/config';

// 從 monorepo 根目錄 package.json 讀取版本號，透過 Vite define 注入到所有檔案
const rootPkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')
);

const integrations = [
  tailwind({
    applyBaseStyles: false,
  }),
  react(),
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
  prefetch: {
    // hover 時預載下一頁，加速感知速度
    prefetchAll: false,
    defaultStrategy: 'hover',
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
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
    define: {
      __APP_VERSION__: JSON.stringify(rootPkg.version),
    },
  },
  integrations,
});
