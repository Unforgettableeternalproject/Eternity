/**
 * UEP DevTools 命令面板（Issue #41 T-15）
 *
 * 快捷鍵：Ctrl+Shift+D（開啟 / 關閉）
 * Mount 條件（AND-any）：
 *   1. isTestMode() === true（cookie 或 build-time env 指向 test worker）
 *   2. localStorage['uep-devtools-force'] === 'true'（本地開發強制）
 *   3. import.meta.env.DEV === true（本地 dev server 永遠開）
 *
 * 用 createPortal 掛到 document.body，避開任何 stacking context 干擾
 * （S5 踩過三次浮島 transform stacking context 吃掉 fixed 定位的坑）。
 *
 * Action 註冊在各功能模組的 `<xxx>Actions.ts`——面板只負責顯示與分派。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';

import { uepDialog } from '../components/ui/UepDialog';

import { isTestMode } from '../lib/apiBase';
import { setDispelPaused } from '../lib/idleVeil';
import { getRegistry, type DevToolAction } from './actionRegistry';
import { registerAllActions } from './actions';

import './UepDevTools.css';

const FORCE_STORAGE_KEY = 'uep-devtools-force';

/** 決定面板是否應該掛載於當前環境 */
function shouldMount(): boolean {
  if (typeof window === 'undefined') return false;
  if (import.meta.env.DEV) return true;
  if (isTestMode()) return true;
  try {
    return window.localStorage.getItem(FORCE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

interface RecentResult {
  id: string;
  label: string;
  ok: boolean;
  error?: string;
  ts: number;
}

/**
 * 面板實作本體。渲染於 `createPortal(document.body)`，
 * 由 `<UepDevToolsHost>` 決定是否掛載。
 */
function DevToolsPanel({
  onClose,
}: {
  onClose: () => void;
}): React.ReactElement {
  const registry = getRegistry();
  const [query, setQuery] = useState('');
  const [tick, setTick] = useState(0);
  const [recent, setRecent] = useState<RecentResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // 訂閱執行結果 + 首次 mount 時強制 refresh action 清單
  useEffect(() => {
    const unsubscribe = registry.onResult((result) => {
      const action = registry.getAll().find((a) => a.id === result.id);
      const label = action?.label ?? result.id;
      setRecent((prev) => [
        {
          id: result.id,
          label,
          ok: result.ok,
          error: result.error,
          ts: Date.now(),
        },
        ...prev.slice(0, 4),
      ]);
    });
    inputRef.current?.focus();
    return unsubscribe;
  }, [registry]);

  const allActions = useMemo(() => registry.getAll(), [registry, tick]);
  const groups = useMemo(() => registry.getGroups(), [registry, tick]);

  const filtered: DevToolAction[] = useMemo(() => {
    if (!query.trim()) return allActions;
    const q = query.toLowerCase();
    return allActions.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        (a.description && a.description.toLowerCase().includes(q)) ||
        a.group.toLowerCase().includes(q)
    );
  }, [query, allActions]);

  const dispatch = useCallback(
    async (action: DevToolAction) => {
      if (action.requiresConfirm) {
        const ok = await uepDialog.confirm(
          action.confirmMessage ?? `此操作將執行「${action.label}」。`,
          {
            title: '確認 DevTools 操作',
            confirmText: '執行',
          }
        );
        if (!ok) return;
      }
      await registry.dispatch(action.id);
      // 強制 refresh available() 狀態
      setTick((t) => t + 1);
    },
    [registry]
  );

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') onClose();
  };

  return (
    <div
      className="uep-devtools-overlay"
      role="dialog"
      aria-label="UEP DevTools"
      onKeyDown={handleKeyDown}
      onClick={onClose}
    >
      <div className="uep-devtools-panel" onClick={(e) => e.stopPropagation()}>
        <div className="uep-devtools-panel__header">
          <span className="uep-devtools-panel__brand">
            <span
              className="uep-devtools-panel__brand-dot"
              aria-hidden="true"
            />
            UEP DevTools
          </span>
          <span className="uep-devtools-panel__meta">
            {allActions.length} actions · {groups.length} groups · Ctrl+Shift+D
          </span>
          <button
            type="button"
            className="uep-devtools-panel__close"
            onClick={onClose}
            aria-label="關閉 DevTools"
          >
            ×
          </button>
        </div>

        <div className="uep-devtools-panel__search">
          <input
            ref={inputRef}
            type="text"
            placeholder="搜尋 action…（group / label / id / description）"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="uep-devtools-panel__body">
          {filtered.length === 0 && (
            <div className="uep-devtools-panel__empty">
              {allActions.length === 0
                ? '尚無 action 註冊。功能模組載入後會自動出現。'
                : '無符合搜尋的 action。'}
            </div>
          )}

          {groups.map((group) => {
            const groupActions = filtered.filter((a) => a.group === group);
            if (groupActions.length === 0) return null;
            return (
              <section key={group} className="uep-devtools-panel__group">
                <h3 className="uep-devtools-panel__group-title">{group}</h3>
                <ul className="uep-devtools-panel__list">
                  {groupActions.map((action) => {
                    const disabled = action.available
                      ? !action.available()
                      : false;
                    return (
                      <li key={action.id} className="uep-devtools-panel__item">
                        <button
                          type="button"
                          className={
                            action.destructive
                              ? 'uep-devtools-panel__btn uep-devtools-panel__btn--destructive'
                              : 'uep-devtools-panel__btn'
                          }
                          disabled={disabled}
                          onClick={() => dispatch(action)}
                          title={
                            disabled ? '此 action 在當前頁面不可用' : action.id
                          }
                        >
                          <span className="uep-devtools-panel__label">
                            {action.label}
                          </span>
                          {action.description && (
                            <span className="uep-devtools-panel__desc">
                              {action.description}
                            </span>
                          )}
                          <span className="uep-devtools-panel__id">
                            {action.id}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>

        {recent.length > 0 && (
          <div className="uep-devtools-panel__recent">
            <span className="uep-devtools-panel__recent-title">最近執行</span>
            {recent.map((r) => (
              <span
                key={`${r.id}-${r.ts}`}
                className={
                  r.ok
                    ? 'uep-devtools-panel__recent-item'
                    : 'uep-devtools-panel__recent-item uep-devtools-panel__recent-item--err'
                }
                title={r.error ?? ''}
              >
                {r.ok ? '✓' : '✗'} {r.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * DevTools 掛載宿主。負責：
 * 1. 判斷是否應該掛（isTestMode / DEV / force flag）
 * 2. 註冊所有功能模組的 actions（進 registry）
 * 3. 監聽 Ctrl+Shift+D 開關面板
 * 4. 用 createPortal 渲染面板到 document.body
 */
export default function UepDevToolsHost(): React.ReactElement | null {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  /**
   * 面板開著時停掉閒置帷幕的驅散累積。
   *
   * 不做這件事就沒辦法驗收帷幕：按面板上的按鈕本來就得移動滑鼠，那些位移
   * 會被算成驅散——一叫出來就被自己的操作撥掉。階段推進不受影響（時間照走），
   * 停的只有「使用者正在撥開它」這件事的認定。
   */
  useEffect(() => {
    setDispelPaused(open);
    return () => setDispelPaused(false);
  }, [open]);

  useEffect(() => {
    if (!shouldMount()) return;
    setMounted(true);
    // 確保 registry 存在 + 註冊所有 action（模組載入即註冊）
    registerAllActions();

    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!mounted) return null;
  if (!open) {
    // 隱藏但仍 mount：小小的角落 hint（僅顯示於 hover 附近）
    return createPortal(
      <button
        type="button"
        className="uep-devtools-fab"
        onClick={() => setOpen(true)}
        title="開啟 DevTools（Ctrl+Shift+D）"
        aria-label="開啟 DevTools"
      >
        <span aria-hidden="true">⚡</span>
      </button>,
      document.body
    );
  }
  return createPortal(
    <DevToolsPanel onClose={() => setOpen(false)} />,
    document.body
  );
}
