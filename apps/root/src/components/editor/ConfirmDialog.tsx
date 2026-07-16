import React, { useCallback, useEffect, useRef, useState } from 'react';

/* ──────────────────────────────────────────────────────
 * ConfirmDialog — 取代 window.confirm / window.alert / window.prompt
 * 使用既有 qe-modal 設計語言，支援確認、純提示、文字輸入三種模式
 * ────────────────────────────────────────────────────── */

export interface ConfirmDialogState {
  /** 是否顯示 */
  open: boolean;
  /** 標題文字 */
  title: string;
  /** 說明文字（可選） */
  description?: string;
  /** 確認按鈕文字，預設「確定」 */
  confirmLabel?: string;
  /** 取消按鈕文字，預設「取消」 */
  cancelLabel?: string;
  /** 確認按鈕是否為危險樣式 */
  danger?: boolean;
  /** 純提示模式（只有一個「確定」按鈕，沒有取消） */
  alertOnly?: boolean;
  /** 文字輸入模式（取代 window.prompt） */
  prompt?: boolean;
  /** prompt 的 placeholder */
  promptPlaceholder?: string;
  /** prompt 的預設值 */
  promptDefault?: string;
  /** 確認後的回呼（無輸入） */
  onConfirm?: () => void;
  /** prompt 確認後的回呼（帶輸入值） */
  onPromptConfirm?: (value: string) => void;
}

export const DIALOG_CLOSED: ConfirmDialogState = { open: false, title: '' };

interface Props {
  state: ConfirmDialogState;
  onClose: () => void;
}

export default function ConfirmDialog({ state, onClose }: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState('');

  // 開啟時重置輸入值（如有 promptDefault 則套用）
  useEffect(() => {
    if (state.open) {
      setInputValue(state.promptDefault ?? '');
      // prompt 模式 focus input 並全選，否則 focus 按鈕
      requestAnimationFrame(() => {
        if (state.prompt) {
          inputRef.current?.focus();
          inputRef.current?.select();
        } else {
          confirmRef.current?.focus();
        }
      });
    }
  }, [state.open, state.prompt, state.promptDefault]);

  // ESC 關閉
  useEffect(() => {
    if (!state.open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.open, onClose]);

  const handleConfirm = useCallback(() => {
    if (state.prompt) {
      if (!inputValue.trim()) return; // 空值不關閉
      state.onPromptConfirm?.(inputValue.trim());
    } else {
      state.onConfirm?.();
    }
    onClose();
  }, [state, inputValue, onClose]);

  // Enter 送出（prompt 模式）
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      }
    },
    [handleConfirm]
  );

  if (!state.open) return null;

  return (
    <div className="qe-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="qe-modal"
        style={{ maxWidth: 400 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={state.description ? 'confirm-dialog-desc' : undefined}
      >
        <h3 id="confirm-dialog-title" className="qe-modal__title">
          {state.title}
        </h3>
        {state.description && (
          <p
            id="confirm-dialog-desc"
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: 1.6,
              color: 'var(--qe-ink-soft)',
            }}
          >
            {state.description}
          </p>
        )}
        {state.prompt && (
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={state.promptPlaceholder}
            style={{
              width: '100%',
              marginTop: 12,
              padding: '8px 10px',
              border: '1px solid var(--qe-line)',
              background: 'var(--qe-paper)',
              color: 'var(--qe-ink)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 13,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        )}
        <div className="qe-modal__actions">
          {!state.alertOnly && (
            <button className="qe-topbar__btn" onClick={onClose}>
              <span className="qe-mono">{state.cancelLabel || '取消'}</span>
            </button>
          )}
          <button
            ref={confirmRef}
            className={`qe-topbar__btn ${state.danger ? 'qe-topbar__btn--danger' : 'qe-topbar__btn--primary'}`}
            disabled={state.prompt ? !inputValue.trim() : false}
            onClick={handleConfirm}
          >
            <span className="qe-mono">{state.confirmLabel || '確定'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
