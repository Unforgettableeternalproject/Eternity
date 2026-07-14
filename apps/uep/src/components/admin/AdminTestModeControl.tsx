/**
 * Admin Test Mode 切換控制（Issue #41 T-06）
 *
 * 掛在 admin dashboard 供切換到 / 退出測試環境。
 * - 顯示當前 API 目標與 test mode 狀態
 * - 按鈕：進入或離開測試環境
 * - 二次確認：window.confirm（避免誤觸破壞正在編輯的狀態）
 * - 切換成功後 location.reload() 讓其他模組讀到最新 base URL
 *
 * 對應 apiBase.ts 的三個公開 API。
 * 注意：build-time env 綁到 test worker 的站點，這個 toggle 只能顯示狀態，
 *       無法「切回正式」——需在 URL 層換站。這是預期行為。
 */

import { useCallback, useEffect, useState } from 'react';

import {
  TEST_MODE_COOKIE_NAME,
  TEST_WORKER_BASE_URL,
  getApiBase,
  isTestMode,
  setTestModeOverride,
} from '../../lib/apiBase';
import './AdminTestModeControl.css';

type Source = 'cookie' | 'env' | 'none';

function detectSource(): Source {
  if (typeof document === 'undefined') return 'none';
  if (document.cookie.includes(`${TEST_MODE_COOKIE_NAME}=`)) return 'cookie';
  return isTestMode() ? 'env' : 'none';
}

export default function AdminTestModeControl(): React.ReactElement {
  const [source, setSource] = useState<Source>('none');
  const [apiBase, setApiBase] = useState<string>('');

  useEffect(() => {
    setSource(detectSource());
    setApiBase(getApiBase());
  }, []);

  const inTestMode = source !== 'none';

  const handleEnter = useCallback(() => {
    const ok = window.confirm(
      '即將切換至【測試環境】。\n' +
        '目標：' +
        TEST_WORKER_BASE_URL +
        '\n\n' +
        '⚠ 切換後所有 Reader / Editor 都會讀寫 test D1，\n' +
        '  任何編輯不會影響正式資料。\n\n' +
        '確認切換？'
    );
    if (!ok) return;
    const written = setTestModeOverride(TEST_WORKER_BASE_URL);
    if (!written) {
      window.alert('切換失敗：setTestModeOverride 拒絕寫入');
      return;
    }
    window.location.reload();
  }, []);

  const handleExit = useCallback(() => {
    if (source === 'env') {
      window.alert(
        '此站點於 build 時綁定 test worker，無法用 cookie 清除。\n' +
          '請前往正式站台（不同 URL）以退出測試模式。'
      );
      return;
    }
    const ok = window.confirm('確認退出測試環境並回到正式資料？');
    if (!ok) return;
    setTestModeOverride(null);
    window.location.reload();
  }, [source]);

  return (
    <div
      className={
        inTestMode
          ? 'adm-test-mode-card adm-test-mode-card--active'
          : 'adm-test-mode-card'
      }
    >
      <div className="adm-test-mode-card__header">
        <span
          className={
            inTestMode
              ? 'adm-test-mode-card__dot adm-test-mode-card__dot--test'
              : 'adm-test-mode-card__dot'
          }
          aria-hidden="true"
        />
        <span className="adm-test-mode-card__title">
          {inTestMode ? '測試環境（TEST）' : '正式環境（PROD）'}
        </span>
        {source === 'env' && (
          <span
            className="adm-test-mode-card__badge"
            title="此站於 build 時綁定 test worker"
          >
            build-bound
          </span>
        )}
      </div>

      <div className="adm-test-mode-card__body">
        <div className="adm-test-mode-card__row">
          <span className="adm-test-mode-card__label">當前 API</span>
          <code className="adm-test-mode-card__value">
            {apiBase || '（載入中）'}
          </code>
        </div>
        <div className="adm-test-mode-card__row">
          <span className="adm-test-mode-card__label">Test worker</span>
          <code className="adm-test-mode-card__value">
            {TEST_WORKER_BASE_URL}
          </code>
        </div>
      </div>

      <div className="adm-test-mode-card__actions">
        {inTestMode ? (
          <button
            type="button"
            className="adm-test-mode-card__btn adm-test-mode-card__btn--exit"
            onClick={handleExit}
            disabled={source === 'env'}
          >
            退出測試環境
          </button>
        ) : (
          <button
            type="button"
            className="adm-test-mode-card__btn adm-test-mode-card__btn--enter"
            onClick={handleEnter}
          >
            切換到測試環境
          </button>
        )}
      </div>

      <div className="adm-test-mode-card__hint">
        測試環境使用獨立的 D1 / R2 資源，操作不會影響正式資料（Issue #41）
      </div>
    </div>
  );
}
