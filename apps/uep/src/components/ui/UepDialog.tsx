import { useState, useEffect, useRef, useCallback } from 'react';
import './UepDialog.css';

/* ── 型別 ── */
type DialogKind = 'alert' | 'confirm' | 'prompt';

interface DialogRequest {
  id: number;
  kind: DialogKind;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  placeholder?: string;
  defaultValue?: string;
  resolve: (ok: boolean) => void;
  resolvePrompt?: (value: string | null) => void;
}

/* ── 全域佇列（跨 React island） ── */
let dialogId = 0;
let currentReq: DialogRequest | null = null;
const reqListeners: Array<(r: DialogRequest | null) => void> = [];

declare global {
  interface Window {
    __uepDialogManager?: typeof uepDialog;
  }
}

function notifyAll() {
  reqListeners.forEach((fn) => fn(currentReq));
}

export const uepDialog = {
  /** 顯示 alert 對話框（只有「確定」按鈕） */
  alert(
    message: string,
    opts?: { title?: string; confirmText?: string }
  ): Promise<void> {
    return new Promise((resolve) => {
      currentReq = {
        id: ++dialogId,
        kind: 'alert',
        message,
        title: opts?.title,
        confirmText: opts?.confirmText,
        resolve: () => resolve(),
      };
      notifyAll();
    });
  },

  /** 顯示 confirm 對話框，返回使用者是否點了確認 */
  confirm(
    message: string,
    opts?: { title?: string; confirmText?: string; cancelText?: string }
  ): Promise<boolean> {
    return new Promise((resolve) => {
      currentReq = {
        id: ++dialogId,
        kind: 'confirm',
        message,
        title: opts?.title,
        confirmText: opts?.confirmText,
        cancelText: opts?.cancelText,
        resolve,
      };
      notifyAll();
    });
  },

  /** 顯示 prompt 對話框，返回輸入值或 null */
  prompt(
    message: string,
    opts?: { title?: string; confirmText?: string; cancelText?: string; placeholder?: string; defaultValue?: string }
  ): Promise<string | null> {
    return new Promise((resolve) => {
      currentReq = {
        id: ++dialogId,
        kind: 'prompt',
        message,
        title: opts?.title,
        confirmText: opts?.confirmText,
        cancelText: opts?.cancelText,
        placeholder: opts?.placeholder,
        defaultValue: opts?.defaultValue,
        resolve: () => {},
        resolvePrompt: resolve,
      };
      notifyAll();
    });
  },

  /** 關閉當前對話框 */
  _close(ok: boolean, promptValue?: string) {
    if (currentReq) {
      if (currentReq.kind === 'prompt' && currentReq.resolvePrompt) {
        currentReq.resolvePrompt(ok ? (promptValue ?? '') : null);
      } else {
        currentReq.resolve(ok);
      }
      currentReq = null;
      notifyAll();
    }
  },

  subscribe(listener: (r: DialogRequest | null) => void) {
    reqListeners.push(listener);
    if (currentReq) listener(currentReq);
    return () => {
      const i = reqListeners.indexOf(listener);
      if (i > -1) reqListeners.splice(i, 1);
    };
  },
};

if (typeof window !== 'undefined' && !window.__uepDialogManager) {
  window.__uepDialogManager = uepDialog;
}

/* ── 對話框容器 ── */
export default function UepDialogContainer() {
  const [req, setReq] = useState<DialogRequest | null>(null);
  const [closing, setClosing] = useState(false);
  const [promptValue, setPromptValue] = useState('');
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const mgr = window.__uepDialogManager ?? uepDialog;
    return mgr.subscribe(setReq);
  }, []);

  /* 出現時自動 focus */
  useEffect(() => {
    if (req && !closing) {
      if (req.kind === 'prompt') {
        setPromptValue(req.defaultValue || '');
        setTimeout(() => inputRef.current?.focus(), 50);
      } else {
        confirmRef.current?.focus();
      }
    }
  }, [req, closing]);

  /* Escape 鍵關閉 */
  useEffect(() => {
    if (!req) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [req]);

  const close = useCallback((ok: boolean) => {
    setClosing(true);
    const val = promptValue;
    setTimeout(() => {
      const mgr = window.__uepDialogManager ?? uepDialog;
      mgr._close(ok, val);
      setClosing(false);
      setPromptValue('');
    }, 200);
  }, [promptValue]);

  if (!req) return null;

  const isPrompt = req.kind === 'prompt';
  const showCancel = req.kind === 'confirm' || isPrompt;

  return (
    <div
      className={`uep-dialog-overlay${closing ? ' uep-dialog-overlay--closing' : ''}`}
      onClick={() => close(false)}
    >
      <div
        className={`uep-dialog${closing ? ' uep-dialog--closing' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="uep-dialog-title"
        aria-describedby="uep-dialog-msg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 頂部裝飾線 */}
        <div className="uep-dialog__accent" />

        {req.title && (
          <h2 id="uep-dialog-title" className="uep-dialog__title">
            {req.title}
          </h2>
        )}

        <p id="uep-dialog-msg" className="uep-dialog__message">
          {req.message}
        </p>

        {/* Prompt 輸入框 */}
        {isPrompt && (
          <input
            ref={inputRef}
            className="uep-dialog__input"
            type="text"
            value={promptValue}
            onChange={(e) => setPromptValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && promptValue.trim()) close(true); }}
            placeholder={req.placeholder || ''}
          />
        )}

        <div className="uep-dialog__actions">
          {showCancel && (
            <button
              className="uep-dialog__btn uep-dialog__btn--cancel"
              onClick={() => close(false)}
              type="button"
            >
              {req.cancelText || '取消'}
            </button>
          )}
          <button
            ref={confirmRef}
            className="uep-dialog__btn uep-dialog__btn--confirm"
            onClick={() => close(true)}
            type="button"
            disabled={isPrompt && !promptValue.trim()}
          >
            {req.confirmText || '確定'}
          </button>
        </div>
      </div>
    </div>
  );
}
