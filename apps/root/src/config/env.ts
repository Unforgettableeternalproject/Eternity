/**
 * 環境配置模組
 * 提供統一的環境判斷方法
 */

/**
 * 判斷當前是否為開發模式
 * 本地開發時為 true，build 後為 false
 */
export const isDev = import.meta.env.DEV;

/**
 * 判斷當前是否為生產模式
 * build 後為 true，本地開發時為 false
 */
export const isProd = import.meta.env.PROD;

/**
 * 判斷當前是否為測試環境 (staging)
 * 透過環境變數 PUBLIC_ENVIRONMENT 或 URL 判斷
 */
export const isStaging = (() => {
  // 方式 1: 透過 PUBLIC_ENVIRONMENT 環境變數（在 Cloudflare Pages 設定）
  if (import.meta.env.PUBLIC_ENVIRONMENT === 'staging') {
    return true;
  }

  // 方式 2: 透過 site URL 判斷（fallback）
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    return hostname.includes('staging') || hostname.includes('pages.dev');
  }

  // SSR 時透過 import.meta.env.SITE 判斷
  const site = import.meta.env.SITE || '';
  return site.includes('staging') || site.includes('pages.dev');
})();

/**
 * 判斷當前是否為正式環境 (production)
 * 已 build 且不是 staging
 */
export const isProduction = isProd && !isStaging;

/**
 * 取得當前環境名稱
 */
export const getEnvironment = (): 'development' | 'staging' | 'production' => {
  if (isDev) return 'development';
  if (isStaging) return 'staging';
  return 'production';
};

/**
 * 環境配置
 */
export const envConfig = {
  isDev,
  isProd,
  isStaging,
  isProduction,
  environment: getEnvironment(),
  // Admin 按鈕只在本地開發環境顯示
  showDevTools: isDev,
  // Console 日誌在開發環境和測試環境都啟用
  enableConsoleLog: isDev || isStaging,
} as const;

// 開發時在 console 顯示環境資訊
if (typeof window !== 'undefined' && envConfig.enableConsoleLog) {
  console.log(`[Environment] ${envConfig.environment}`, {
    isDev,
    isProd,
    isStaging,
    isProduction,
    showDevTools: envConfig.showDevTools,
  });
}
