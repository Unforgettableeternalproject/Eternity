import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'discord-widget-sync',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
