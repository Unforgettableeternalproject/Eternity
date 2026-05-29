import React, { useState, useEffect } from 'react';
import RootMediaLibrary from './RootMediaLibrary';

interface ImagePickerDialogProps {
  apiBase: string;
  token: string;
  onInsert: (url: string) => void;
  onClose: () => void;
}

export default function ImagePickerDialog({
  apiBase,
  token,
  onInsert,
  onClose,
}: ImagePickerDialogProps) {
  const [manualUrl, setManualUrl] = useState('');

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="qe-modal-overlay" onClick={onClose}>
      <div
        className="qe-modal qe-imgpicker"
        style={{
          maxWidth: 800,
          width: '90vw',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="qe-imgpicker__header">
          <span className="qe-mono qe-mono--navy">
            —— 插入圖片 · insert image
          </span>
          <button
            className="qe-topbar__btn"
            onClick={onClose}
            style={{ padding: '4px 10px' }}
          >
            <span className="qe-mono">✕ close</span>
          </button>
        </div>

        {/* media library (picker mode) */}
        <div
          className="qe-imgpicker__body"
          style={{ flex: 1, overflow: 'hidden' }}
        >
          <RootMediaLibrary
            apiBase={apiBase}
            token={token}
            mode="picker"
            filterType="image"
            onPick={(key) => {
              onInsert(key);
              onClose();
            }}
          />
        </div>

        {/* manual URL fallback */}
        <div className="qe-imgpicker__manual">
          <input
            className="qe-imgpicker__url-input"
            placeholder="或直接貼上圖片 URL…"
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && manualUrl.trim()) {
                onInsert(manualUrl.trim());
                onClose();
              }
            }}
          />
          <button
            className="qe-topbar__btn qe-topbar__btn--primary"
            disabled={!manualUrl.trim()}
            onClick={() => {
              if (manualUrl.trim()) {
                onInsert(manualUrl.trim());
                onClose();
              }
            }}
          >
            <span className="qe-mono" style={{ color: 'inherit' }}>
              insert
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
