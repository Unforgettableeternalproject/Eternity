import baseConfig from '@uep/config/tailwind/base.js';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}',
    '../../packages/ui/src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}',
  ],
  presets: [baseConfig],
  theme: {
    extend: {
      // App-specific customizations can go here
      // The base config will be merged automatically
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
