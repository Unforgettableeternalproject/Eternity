import mdx from '@astrojs/mdx';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://uep.unforgettableeternalproject.com',
  outDir: './dist',
  integrations: [mdx()],
  build: {
    format: 'directory',
  },
});
