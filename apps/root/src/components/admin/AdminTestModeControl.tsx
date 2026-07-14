/**
 * Admin Test Mode 切換控制（Issue #41 T-06 / T-10）
 *
 * 掛在 admin dashboard 供切換到 / 退出測試環境；並提供 test 資料 reset。
 * - 顯示當前 API 目標與 test mode 狀態
 * - 按鈕：進入或離開測試環境（window.confirm 二次確認）
 * - 切換成功後 location.reload() 讓其他模組讀到最新 base URL
 * - Reset section（T-10）：僅 inTestMode && source==='cookie' 顯示
 *   - 輸入 `RESET TEST`（case-sensitive）才 enabled
 *   - 呼叫 POST /api/test/reset（帶 cookie JWT）
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
type ResetState = 'idle' | 'loading' | 'done' | 'error';

/** Admin JWT cookie 名稱（uep 站與 root 站不同，兩者都試以支援共用元件） */
const JWT_COOKIE_CANDIDATES = ['uep-admin-jwt', 'root-admin-jwt'];

function detectSource(): Source {
  if (typeof document === 'undefined') return 'none';
  if (document.cookie.includes(`${TEST_MODE_COOKIE_NAME}=`)) return 'cookie';
  return isTestMode() ? 'env' : 'none';
}

/** 從 document.cookie 抓 admin JWT（若沒登入則 undefined） */
function readAdminJwt(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const parts = document.cookie.split('; ').filter(Boolean);
  for (const raw of parts) {
    const eq = raw.indexOf('=');
    if (eq < 0) continue;
    const name = raw.slice(0, eq);
    if (JWT_COOKIE_CANDIDATES.includes(name)) {
      return decodeURIComponent(raw.slice(eq + 1));
    }
  }
  return undefined;
}

export default function AdminTestModeControl(): React.ReactElement {
  const [source, setSource] = useState<Source>('none');
  const [apiBase, setApiBase] = useState<string>('');
  const [resetConfirmInput, setResetConfirmInput] = useState('');
  const [resetState, setResetState] = useState<ResetState>('idle');
  const [resetMessage, setResetMessage] = useState('');

  useEffect(() => {
    setSource(detectSource());
    setApiBase(getApiBase());
  }, []);

  const inTestMode = source !== 'none';
  const canReset = inTestMode && source === 'cookie';
  const resetEnabled = resetConfirmInput === 'RESET TEST';

  const handleReset = useCallback(async () => {
    if (!resetEnabled) return;
    setResetState('loading');
    setResetMessage('');
    try {
      const base = getApiBase();
      const jwt = readAdminJwt();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (jwt) headers['Authorization'] = `Bearer ${jwt}`;

      const res = await fetch(`${base}/api/test/reset`, {
        method: 'POST',
        headers,
      });

      if (!res.ok) {
        const errJson = (await res
          .json()
          .catch(() => ({ error: res.statusText }))) as { error?: string };
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const json = (await res.json()) as {
        ok: boolean;
        data?: { tables: string[]; totalRows: number; clearedAt: string };
      };
      setResetState('done');
      const tables = json.data?.tables?.join(', ') ?? '（未知）';
      const rows = json.data?.totalRows ?? 0;
      setResetMessage(`完成：清除 ${rows} 筆（表格：${tables}）`);
      setResetConfirmInput('');
    } catch (err) {
      setResetState('error');
      setResetMessage(err instanceof Error ? err.message : String(err));
    }
  }, [resetEnabled]);

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

      {canReset && (
        <div className="adm-test-mode-card__reset-section">
          <div className="adm-test-mode-card__reset-label">重置測試資料</div>
          <div className="adm-test-mode-card__reset-hint">
            輸入 <code>RESET TEST</code> 以啟用按鈕。此操作清空 test D1
            所有業務資料，無法復原。
          </div>
          <div className="adm-test-mode-card__reset-row">
            <input
              type="text"
              className="adm-test-mode-card__reset-input"
              placeholder="RESET TEST"
              value={resetConfirmInput}
              onChange={(e) => {
                setResetConfirmInput(e.target.value);
                if (resetState !== 'idle') {
                  setResetState('idle');
                  setResetMessage('');
                }
              }}
              disabled={resetState === 'loading'}
              aria-label="輸入 RESET TEST 確認重置"
            />
            <button
              type="button"
              className="adm-test-mode-card__btn adm-test-mode-card__btn--reset"
              onClick={handleReset}
              disabled={!resetEnabled || resetState === 'loading'}
            >
              {resetState === 'loading' ? '重置中…' : '執行重置'}
            </button>
          </div>
          {resetMessage && (
            <div
              className={
                resetState === 'error'
                  ? 'adm-test-mode-card__reset-msg adm-test-mode-card__reset-msg--err'
                  : 'adm-test-mode-card__reset-msg adm-test-mode-card__reset-msg--ok'
              }
              role="status"
            >
              {resetMessage}
            </div>
          )}
        </div>
      )}

      <div className="adm-test-mode-card__hint">
        測試環境使用獨立的 D1 / R2 資源，操作不會影響正式資料（Issue #41）
      </div>
    </div>
  );
}
