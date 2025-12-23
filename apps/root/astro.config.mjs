import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

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
  integrations: [
    tailwind({
      applyBaseStyles: false, // 我們會自訂基礎樣式
    }),
  ],
});
