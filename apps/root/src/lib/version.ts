/**
 * 應用程式版本號
 * 由 Vite define 在建置時注入（見 astro.config.mjs）
 * 來源：monorepo 根目錄 package.json 的 version 欄位
 */
declare const __APP_VERSION__: string;

/** 帶 v 前綴的版本號，如 "v0.9.8" */
export const APP_VERSION = `v${__APP_VERSION__}`;

/** 不帶前綴的版本號，如 "0.9.8" */
export const APP_VERSION_RAW = __APP_VERSION__;
