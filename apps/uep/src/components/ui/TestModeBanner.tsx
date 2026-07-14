/**
 * TEST MODE Banner（Issue #41）
 *
 * 全站頂端固定紅色橫幅，當網站處於測試環境時強制提醒使用者。
 *
 * 顯示條件（來自 `apiBase.isTestMode()`）：
 * 1. Cookie `uep-test-api-url` 存在且為合法 test worker URL；或
 * 2. build-time `PUBLIC_CONTENT_API_URL` 直接指向 test worker（test Pages 部署場景）
 *
 * 互動：整條 banner 可點擊，點擊後清除 override cookie 並 reload。
 * 若目前是 build-time env 綁定，清 cookie 也不會退出 test mode——這是刻意的：
 * env 綁定情境下退出只能從 URL 換站，banner 會告知使用者。
 *
 * 掛點：DesignLayout / BaseLayout 的 `<body>` 開頭，`client:load` 立即 hydrate。
 */

import { useCallback, useEffect, useState } from 'react';

import {
  TEST_MODE_COOKIE_NAME,
  TEST_WORKER_BASE_URL,
  isTestMode,
  setTestModeOverride,
} from '../../lib/apiBase';
import './TestModeBanner.css';

/** 判斷目前 test mode 是「cookie 觸發」還是「build-time env 綁定」 */
function detectSource(): 'cookie' | 'env' | null {
  if (typeof document === 'undefined') return null;
  const hasCookie = document.cookie.includes(`${TEST_MODE_COOKIE_NAME}=`);
  if (hasCookie) return 'cookie';
  return isTestMode() ? 'env' : null;
}

export default function TestModeBanner(): React.ReactElement | null {
  // SSR 首次渲染時預設 false，避免 Astro hydration mismatch；
  // 掛載後才依 isTestMode() 決定顯示（架構稿接受 0.1~0.3s 閃爍）。
  const [visible, setVisible] = useState(false);
  const [source, setSource] = useState<'cookie' | 'env' | null>(null);

  useEffect(() => {
    const testMode = isTestMode();
    setVisible(testMode);
    setSource(detectSource());
    if (testMode) {
      document.body.classList.add('has-test-banner');
    }
    return () => {
      document.body.classList.remove('has-test-banner');
    };
  }, []);

  const handleExit = useCallback(() => {
    if (source === 'env') {
      // build-time 綁定無法清除，僅提示
      alert(
        '此站點於 build 時綁定 test worker，無法用 cookie 清除。\n請前往正式站台（不同 URL）以退出測試模式。'
      );
      return;
    }
    setTestModeOverride(null);
    window.location.reload();
  }, [source]);

  if (!visible) return null;

  return (
    <div
      className="uep-test-mode-banner"
      role="alert"
      aria-live="polite"
      onClick={handleExit}
      title={
        source === 'env'
          ? '此站已綁定測試 worker（無法用 cookie 退出）'
          : '點擊退出測試模式'
      }
    >
      <span className="uep-test-mode-banner__icon" aria-hidden="true">
        ⚠
      </span>
      <span className="uep-test-mode-banner__label">TEST MODE</span>
      <span className="uep-test-mode-banner__hint">
        資料不是正式內容 · API: {TEST_WORKER_BASE_URL}
        {source === 'cookie' ? ' · 點擊退出' : ' · 綁定於此站'}
      </span>
    </div>
  );
}
