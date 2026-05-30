import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';
import { defineConfig } from 'astro/config';

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
  },
  integrations,
});
