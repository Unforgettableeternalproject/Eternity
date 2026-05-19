import astroConfig from '@uep/config/eslint/astro.js';

export default [
  ...astroConfig,
  {
    // Astro parser 無法正確解析 client:only 指令，排除此檔案
    ignores: ['src/layouts/DesignLayout.astro'],
  },
];
