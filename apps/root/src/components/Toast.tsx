import { useState, useEffect, useCallback } from 'react';
import './Toast.css';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastProps {
  toast: ToastMessage;
  onClose: (id: string) => void;
}

function Toast({ toast, onClose }: ToastProps) {
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    const duration = toast.duration || 3000;
    const timer = setTimeout(() => {
      handleClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [toast]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose(toast.id);
    }, 300); // 等待動畫完成
  };

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return (
          <svg className="toast__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'error':
        return (
          <svg className="toast__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      case 'warning':
        return (
          <svg className="toast__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        );
      case 'info':
        return (
          <svg className="toast__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  return (
    <div 
      className={`toast toast--${toast.type} ${isClosing ? 'toast--closing' : ''}`}
      role="alert"
    >
      <div className="toast__icon-wrapper">
        {getIcon()}
      </div>
      <p className="toast__message">{toast.message}</p>
      <button
        onClick={handleClose}
        className="toast__close"
        aria-label="關閉通知"
        type="button"
      >
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

interface ToastContainerProps {
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center';
}

let toastIdCounter = 0;
const toastListeners: Array<(toasts: ToastMessage[]) => void> = [];
let toastsState: ToastMessage[] = [];

export const toastManager = {
  show: (message: string, type: ToastType = 'info', duration = 3000) => {
    const toast: ToastMessage = {
      id: `toast-${++toastIdCounter}`,
      type,
      message,
      duration,
    };

    toastsState = [...toastsState, toast];
    toastListeners.forEach(listener => listener(toastsState));
    
    return toast.id;
  },

  success: (message: string, duration?: number) => {
    return toastManager.show(message, 'success', duration);
  },

  error: (message: string, duration?: number) => {
    return toastManager.show(message, 'error', duration);
  },

  warning: (message: string, duration?: number) => {
    return toastManager.show(message, 'warning', duration);
  },

  info: (message: string, duration?: number) => {
    return toastManager.show(message, 'info', duration);
  },

  dismiss: (id: string) => {
    toastsState = toastsState.filter(t => t.id !== id);
    toastListeners.forEach(listener => listener(toastsState));
  },

  dismissAll: () => {
    toastsState = [];
    toastListeners.forEach(listener => listener(toastsState));
  },

  subscribe: (listener: (toasts: ToastMessage[]) => void) => {
    toastListeners.push(listener);
    return () => {
      const index = toastListeners.indexOf(listener);
      if (index > -1) {
        toastListeners.splice(index, 1);
      }
    };
  },
};

export default function ToastContainer({ position = 'top-right' }: ToastContainerProps) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const unsubscribe = toastManager.subscribe(setToasts);
    return unsubscribe;
  }, []);

  const handleClose = useCallback((id: string) => {
    toastManager.dismiss(id);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className={`toast-container toast-container--${position}`}>
      {toasts.map(toast => (
        <Toast key={toast.id} toast={toast} onClose={handleClose} />
      ))}
    </div>
  );
}
