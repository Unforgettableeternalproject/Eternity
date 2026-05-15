import React, { useState, useEffect, useCallback } from 'react';
import './UepToast.css';

/* ── 型別 ── */
export type UepToastType = 'success' | 'error' | 'warning' | 'info';

export interface UepToastMessage {
  id: string;
  type: UepToastType;
  message: string;
  duration?: number;
}

/* ── 圖標 ── */
const icons: Record<UepToastType, React.ReactElement> = {
  success: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
};

/* ── 全域狀態管理（跨 React island） ── */
let idCounter = 0;
let state: UepToastMessage[] = [];
const listeners: Array<(t: UepToastMessage[]) => void> = [];
let pending: UepToastMessage[] = [];

declare global {
  interface Window {
    __uepToastManager?: typeof uepToast;
  }
}

function notify() {
  listeners.forEach((fn) => fn(state));
}

export const uepToast = {
  show(message: string, type: UepToastType = 'info', duration = 3500) {
    const toast: UepToastMessage = {
      id: `uep-toast-${++idCounter}`,
      type,
      message,
      duration,
    };
    state = [...state, toast];

    if (listeners.length > 0) {
      notify();
    } else {
      pending.push(toast);
      setTimeout(() => {
        if (listeners.length > 0 && pending.length > 0) {
          notify();
          pending = [];
        }
      }, 100);
    }
    return toast.id;
  },

  success: (msg: string, dur?: number) => uepToast.show(msg, 'success', dur),
  error: (msg: string, dur?: number) => uepToast.show(msg, 'error', dur),
  warning: (msg: string, dur?: number) => uepToast.show(msg, 'warning', dur),
  info: (msg: string, dur?: number) => uepToast.show(msg, 'info', dur),

  dismiss(id: string) {
    state = state.filter((t) => t.id !== id);
    notify();
  },
  dismissAll() {
    state = [];
    notify();
  },

  subscribe(listener: (t: UepToastMessage[]) => void) {
    listeners.push(listener);
    if (pending.length > 0) {
      listener(state);
      pending = [];
    }
    return () => {
      const i = listeners.indexOf(listener);
      if (i > -1) listeners.splice(i, 1);
    };
  },
};

if (typeof window !== 'undefined' && !window.__uepToastManager) {
  window.__uepToastManager = uepToast;
}

/* ── 單一 Toast 元件 ── */
function ToastItem({
  toast,
  onClose,
}: {
  toast: UepToastMessage;
  onClose: (id: string) => void;
}) {
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setClosing(true);
      setTimeout(() => onClose(toast.id), 280);
    }, toast.duration || 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => onClose(toast.id), 280);
  };

  return (
    <div
      className={`uep-toast uep-toast--${toast.type}${closing ? ' uep-toast--closing' : ''}`}
      role="alert"
    >
      <span className="uep-toast__icon">{icons[toast.type]}</span>
      <p className="uep-toast__msg">{toast.message}</p>
      <button
        className="uep-toast__close"
        onClick={handleClose}
        aria-label="關閉通知"
        type="button"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}

/* ── 容器（掛在 Layout 層級） ── */
export default function UepToastContainer() {
  const [toasts, setToasts] = useState<UepToastMessage[]>([]);

  useEffect(() => {
    const mgr = window.__uepToastManager ?? uepToast;
    return mgr.subscribe(setToasts);
  }, []);

  const handleClose = useCallback((id: string) => {
    const mgr = window.__uepToastManager ?? uepToast;
    mgr.dismiss(id);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="uep-toast-container">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onClose={handleClose} />
      ))}
    </div>
  );
}
