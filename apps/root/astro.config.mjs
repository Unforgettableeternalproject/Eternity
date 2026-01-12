import markdoc from '@astrojs/markdoc';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import keystatic from '@keystatic/astro';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://unforgettableeternalproject.com',
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
  integrations: [
    tailwind({
      applyBaseStyles: false, // 我們會自訂基礎樣式
    }),
    markdoc(),
    react(),
    keystatic(),
  ],
});
