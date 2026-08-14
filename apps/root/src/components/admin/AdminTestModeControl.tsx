/**
 * Admin Test Mode 切換控制（Issue #41 T-06 / T-10）
 *
 * 掛在 admin dashboard 供切換到 / 退出測試環境；並提供 test 資料 reset。
 * - 顯示當前 API 目標與 test mode 狀態
 * - 按鈕：進入或離開測試環境（window.confirm 二次確認）
 * - 切換成功後 location.reload() 讓其他模組讀到最新 base URL
 * - Reset section（T-10）：所有 test mode 來源皆顯示
 *   - 輸入 `RESET TEST`（case-sensitive）才 enabled
 *   - 呼叫 POST /api/test/reset（帶 cookie JWT）
 *
 * 主站掛載位置是浮動在 RootEditor 上的 fixed 容器，會蓋住 Inspector 欄，
 * 因此提供收合（預設收成右上角狀態藥丸，偏好存 localStorage）與
 * 展開時抓標題列拖曳移動（僅當次有效，不持久化）。
 *
 * 對應 apiBase.ts 的三個公開 API。
 * 注意：build-time env 綁到 test worker 的站點，這個 toggle 只能顯示狀態，
 *       無法「切回正式」——需在 URL 層換站。這是預期行為。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

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

/** 收合偏好的 localStorage key（'0' = 展開，其他/缺值 = 收合） */
const COLLAPSE_STORAGE_KEY = 'root-admin-test-panel-collapsed';

function detectSource(): Source {
  if (typeof document === 'undefined') return 'none';
  if (document.cookie.includes(`${TEST_MODE_COOKIE_NAME}=`)) return 'cookie';
  return isTestMode() ? 'env' : 'none';
}

function readCollapsedPref(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

function writeCollapsedPref(collapsed: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    /* localStorage 不可用時僅影響偏好記憶，忽略 */
  }
}

/** 拖曳進行中的快照（anchor = offset 為 0 時卡片的視窗座標） */
interface DragSnapshot {
  pointerId: number;
  startX: number;
  startY: number;
  baseX: number;
  baseY: number;
  anchorLeft: number;
  anchorTop: number;
  width: number;
  height: number;
}

export default function AdminTestModeControl(): React.JSX.Element {
  const [source, setSource] = useState<Source>('none');
  const [apiBase, setApiBase] = useState<string>('');
  const [resetConfirmInput, setResetConfirmInput] = useState('');
  const [resetState, setResetState] = useState<ResetState>('idle');
  const [resetMessage, setResetMessage] = useState('');
  const [collapsed, setCollapsed] = useState(true);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const cardRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragSnapshot | null>(null);

  useEffect(() => {
    setSource(detectSource());
    setApiBase(getApiBase());
    setCollapsed(readCollapsedPref());
  }, []);

  const inTestMode = source !== 'none';
  const canReset = inTestMode;
  const resetEnabled = resetConfirmInput === 'RESET TEST';

  const handleReset = useCallback(async () => {
    if (!resetEnabled) return;
    setResetState('loading');
    setResetMessage('');
    try {
      const res = await fetch('/api/test/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        const errJson = (await res
          .json()
          .catch(() => ({ error: res.statusText }))) as { error?: string };
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const json = (await res.json()) as {
        ok: boolean;
        data?: {
          tables: string[];
          totalRows: number;
          seeded?: { pages?: number };
        };
      };
      setResetState('done');
      const rows = json.data?.totalRows ?? 0;
      const pages = json.data?.seeded?.pages ?? 0;
      setResetMessage(`完成：清除 ${rows} 筆並重新建立 ${pages} 個頁面骨架`);
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

  const handleToggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsedPref(next);
      return next;
    });
  }, []);

  const handleDragStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // 標題列上的按鈕（收合鈕）不啟動拖曳
      if ((e.target as HTMLElement).closest('button')) return;
      const el = cardRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        baseX: dragOffset.x,
        baseY: dragOffset.y,
        anchorLeft: rect.left - dragOffset.x,
        anchorTop: rect.top - dragOffset.y,
        width: rect.width,
        height: rect.height,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [dragOffset]
  );

  const handleDragMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const margin = 8;
      // 卡片可能比視窗高，垂直方向只保證標題列留在視窗內
      const minX = margin - drag.anchorLeft;
      const maxX = window.innerWidth - drag.width - margin - drag.anchorLeft;
      const minY = margin - drag.anchorTop;
      const maxY = window.innerHeight - 48 - drag.anchorTop;
      setDragOffset({
        x: Math.min(
          Math.max(drag.baseX + (e.clientX - drag.startX), minX),
          maxX
        ),
        y: Math.min(
          Math.max(drag.baseY + (e.clientY - drag.startY), minY),
          maxY
        ),
      });
    },
    []
  );

  const handleDragEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== e.pointerId) return;
    dragRef.current = null;
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

  if (collapsed) {
    return (
      <button
        type="button"
        className={
          inTestMode
            ? 'adm-test-mode-pill adm-test-mode-pill--active'
            : 'adm-test-mode-pill'
        }
        onClick={handleToggleCollapse}
        aria-expanded="false"
        title={`展開測試環境面板（當前：${inTestMode ? 'TEST' : 'PROD'}）`}
      >
        <span
          className={
            inTestMode
              ? 'adm-test-mode-card__dot adm-test-mode-card__dot--test'
              : 'adm-test-mode-card__dot'
          }
          aria-hidden="true"
        />
        <span className="adm-test-mode-pill__label">
          {inTestMode ? 'TEST' : 'PROD'}
        </span>
        <span className="adm-test-mode-pill__chevron" aria-hidden="true">
          ▴
        </span>
      </button>
    );
  }

  return (
    <div
      ref={cardRef}
      className={
        inTestMode
          ? 'adm-test-mode-card adm-test-mode-card--active'
          : 'adm-test-mode-card'
      }
      style={
        dragOffset.x || dragOffset.y
          ? { transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }
          : undefined
      }
    >
      <div
        className="adm-test-mode-card__header adm-test-mode-card__header--draggable"
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
        title="拖曳移動面板"
      >
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
        <button
          type="button"
          className="adm-test-mode-card__collapse"
          onClick={handleToggleCollapse}
          aria-expanded="true"
          aria-label="收合測試環境面板"
          title="收合面板"
        >
          ─
        </button>
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
            輸入 <code>RESET TEST</code> 以啟用按鈕。此操作會清除 test D1
            業務資料，並依正式 D1 的種子規則重新建立測試資料。
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
