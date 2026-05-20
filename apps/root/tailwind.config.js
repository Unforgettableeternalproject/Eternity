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
      // Prism theme overrides — only affects apps/root
      colors: {
        // Primary: Indigo (replaces sky-blue)
        primary: {
          50: '#EEF2FF',
          100: '#E0E7FF',
          200: '#C7D2FE',
          300: '#A5B4FC',
          400: '#818CF8',
          500: '#6366F1',
          600: '#4F46E5',
          700: '#4338CA',
          800: '#3730A3',
          900: '#312E81',
          950: '#1E1B4B',
        },
        // Secondary: Violet (replaces fuchsia, more aligned with Prism)
        secondary: {
          50: '#F5F3FF',
          100: '#EDE9FE',
          200: '#DDD6FE',
          300: '#C4B5FD',
          400: '#A78BFA',
          500: '#8B5CF6',
          600: '#7C3AED',
          700: '#6D28D9',
          800: '#5B21B6',
          900: '#4C1D95',
          950: '#2E1065',
        },
      },
      fontFamily: {
        sans: [
          'Plus Jakarta Sans',
          'Noto Sans TC',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'Cascadia Code',
          'Consolas',
          'monospace',
        ],
      },
      // Prism background tokens
      backgroundColor: {
        'prism-paper': 'var(--prism-paper, #F8F7F3)',
        'prism-surface': 'var(--prism-surface, #FFFFFF)',
      },
      textColor: {
        'prism-ink': 'var(--prism-ink, #0F1530)',
        'prism-ink-soft': 'var(--prism-ink-soft, #3B4360)',
        'prism-ink-mute': 'var(--prism-ink-mute, #7B8398)',
      },
      borderColor: {
        'prism-line': 'var(--prism-line, rgba(15,21,48,0.10))',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
