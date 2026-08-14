/**
 * WidgetEditor — 小工具設定編輯器
 * 不能新增/刪除 widget，只能編輯現有 widget 的內容和設定
 * 資料存在 D1 root_cards 表
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  Mono,
  Divider,
  Field,
  Input,
  Toggle,
  OutlineRow,
} from './editorPrimitives';
import RootMediaLibrary from './RootMediaLibrary';
import { UploadSpinner } from './UploadSpinner';
import type { RootCard } from '../../lib/api';

// ── 型別 ─────────────────────────────────────────────────

interface WidgetDef {
  cardKey: string;
  icon: string;
  label: string;
  labelEn: string;
}

interface WidgetEditorProps {
  cards: RootCard[];
  api: (
    path: string,
    method: string,
    body?: unknown
  ) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
  apiBase: string;
  token: string;
  visitorApiUrl: string;
}

// ── Widget 定義（不可由使用者新增） ──────────────────────────

const WIDGET_DEFS: WidgetDef[] = [
  { cardKey: 'card-music', icon: '♪', label: '音樂播放器', labelEn: 'MUSIC' },
  {
    cardKey: 'card-visitor-counter',
    icon: '●',
    label: '訪客計數',
    labelEn: 'VISITORS',
  },
  { cardKey: 'card-quote', icon: '❝', label: '每日名言', labelEn: 'QUOTE' },
  { cardKey: 'card-portal', icon: '◎', label: '隨機探索', labelEn: 'PORTAL' },
  { cardKey: 'card-status', icon: '◆', label: '網站狀態', labelEn: 'STATUS' },
  { cardKey: 'card-uep', icon: 'U', label: 'U.E.P', labelEn: 'U.E.P' },
];

const WIDGET_DEFAULTS: Record<string, Record<string, unknown>> = {
  'card-music': {
    enabled: false,
    order: 1,
    position: 'left',
    tracks: [],
  },
  'card-visitor-counter': {
    enabled: false,
    order: 2,
    position: 'left',
  },
  'card-quote': {
    enabled: false,
    order: 3,
    position: 'left',
  },
  'card-portal': {
    enabled: false,
    order: 4,
    position: 'left',
  },
  'card-status': {
    enabled: false,
    order: 5,
    position: 'left',
    items: [
      { key: 'STATUS', value: 'Online', color: 'green' },
      { key: 'VERSION', value: 'v0.9.8', color: 'navy' },
    ],
  },
  'card-uep': {
    enabled: false,
    order: 6,
    position: 'left',
    image: '/uep/Show.webp',
  },
};

function isEnabledValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return false;
}

function withWidgetDefaults(
  cardKey: string,
  content: Record<string, unknown> | undefined
): Record<string, unknown> {
  return { ...(WIDGET_DEFAULTS[cardKey] || {}), ...(content || {}) };
}

// ── 主元件 ──────────────────────────────────────────────

export default function WidgetEditor({
  cards,
  api,
  apiBase,
  token,
  visitorApiUrl,
}: WidgetEditorProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [cardMap, setCardMap] = useState<
    Record<string, Record<string, unknown>>
  >(() => {
    const m: Record<string, Record<string, unknown>> = {};
    for (const c of cards) {
      m[c.sectionId] = withWidgetDefaults(c.sectionId, c.content);
    }
    return m;
  });
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const selected = WIDGET_DEFS[selectedIdx];
  const content = withWidgetDefaults(
    selected.cardKey,
    cardMap[selected.cardKey]
  );

  const updateField = useCallback(
    (key: string, value: unknown) => {
      setCardMap((prev) => ({
        ...prev,
        [selected.cardKey]: {
          ...withWidgetDefaults(selected.cardKey, prev[selected.cardKey]),
          [key]: value,
        },
      }));
      setDirty((prev) => new Set(prev).add(selected.cardKey));
    },
    [selected.cardKey]
  );

  const handleSave = async (cardKey: string) => {
    setSaving(true);
    const body = withWidgetDefaults(cardKey, cardMap[cardKey]);
    const res = await api(`/api/root/cards/${cardKey}`, 'PUT', {
      content: body,
    });
    setSaving(false);
    if (res.ok) {
      setDirty((prev) => {
        const next = new Set(prev);
        next.delete(cardKey);
        return next;
      });
      setToast('✓ 已儲存');
      setTimeout(() => setToast(''), 2000);
    } else {
      setToast(`✗ ${res.error || '儲存失敗'}`);
      setTimeout(() => setToast(''), 3000);
    }
  };

  return (
    <>
      {/* ─── 左側：widget 清單 ─── */}
      <aside className="qe-left">
        <div className="qe-left__header">
          <Mono v="navy">—— WIDGETS</Mono>
          <Mono v="fade">{WIDGET_DEFS.length} items</Mono>
        </div>
        <div className="qe-left__list">
          {WIDGET_DEFS.map((w, i) => {
            const isEnabled = isEnabledValue(cardMap[w.cardKey]?.enabled);
            const isDirty = dirty.has(w.cardKey);
            return (
              <OutlineRow
                key={w.cardKey}
                active={selectedIdx === i}
                num={w.icon}
                label={w.label}
                sub={`${isEnabled ? '啟用中' : '停用'}${isDirty ? ' · 未儲存' : ''}`}
                onClick={() => setSelectedIdx(i)}
              />
            );
          })}
        </div>
      </aside>

      {/* ─── 中間：widget 內容編輯 ─── */}
      <div className="qe-center">
        <div className="qe-editor-surface">
          <div style={{ marginBottom: 20 }}>
            <Mono v="navy" style={{ fontSize: 13 }}>
              {selected.icon} {selected.labelEn}
            </Mono>
            <h2
              style={{
                margin: '8px 0 0',
                fontSize: 22,
                fontWeight: 700,
                color: 'var(--q-ink)',
              }}
            >
              {selected.label}
            </h2>
          </div>

          <Divider label="基本設定" />
          <Toggle
            label="啟用"
            checked={isEnabledValue(content.enabled)}
            onChange={(v) => updateField('enabled', v)}
          />

          {/* 依 widget 類型渲染不同的編輯欄位 */}
          {selected.cardKey === 'card-music' && (
            <MusicEditor
              content={content}
              updateField={updateField}
              apiBase={apiBase}
              token={token}
            />
          )}
          {selected.cardKey === 'card-visitor-counter' && (
            <VisitorEditor visitorApiUrl={visitorApiUrl} token={token} />
          )}
          {selected.cardKey === 'card-quote' && (
            <QuoteEditor content={content} updateField={updateField} />
          )}
          {selected.cardKey === 'card-portal' && <PortalEditor />}
          {selected.cardKey === 'card-status' && (
            <StatusEditor content={content} updateField={updateField} />
          )}
          {selected.cardKey === 'card-uep' && (
            <UEPEditor content={content} updateField={updateField} />
          )}
        </div>
      </div>

      {/* ─── 右側：Inspector ─── */}
      <aside className="qe-right">
        <div className="qe-right__header">
          <Mono v="navy">inspector</Mono>
        </div>
        <div className="qe-right__body">
          <Divider label="source" />
          <Field label="table">
            <Input value="root_cards" onChange={() => {}} disabled />
          </Field>
          <Field label="key">
            <Input value={selected.cardKey} onChange={() => {}} disabled mono />
          </Field>

          <Divider label="status" />
          <Field label="enabled">
            <Mono v={isEnabledValue(content.enabled) ? 'navy' : 'fade'}>
              {isEnabledValue(content.enabled) ? 'ON' : 'OFF'}
            </Mono>
          </Field>
          <Field label="dirty">
            <Mono v={dirty.has(selected.cardKey) ? 'coral' : 'fade'}>
              {dirty.has(selected.cardKey) ? '未儲存' : '—'}
            </Mono>
          </Field>

          <Divider label="actions" />
          <button
            className="qe-topbar__btn qe-topbar__btn--primary"
            onClick={() => handleSave(selected.cardKey)}
            disabled={saving || !dirty.has(selected.cardKey)}
            style={{
              width: '100%',
            }}
          >
            <Mono style={{ color: 'inherit' }}>
              {saving
                ? 'saving...'
                : dirty.has(selected.cardKey)
                  ? '● save'
                  : 'synced'}
            </Mono>
          </button>
        </div>
      </aside>

      {toast && <div className="qe-toast">{toast}</div>}
    </>
  );
}

// ── 音樂播放器編輯器 ────────────────────────────────────────

function MusicEditor({
  content,
  updateField,
  apiBase,
  token,
}: {
  content: Record<string, unknown>;
  updateField: (key: string, value: unknown) => void;
  apiBase: string;
  token: string;
}) {
  const tracks =
    (content.tracks as { title: string; artist: string; url: string }[]) || [];
  const [showPicker, setShowPicker] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadIdx, setUploadIdx] = useState<number | null>(null);
  /** 正在上傳的曲目 index——每首各自顯示 spinner */
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);

  const updateTrack = (idx: number, field: string, value: string) => {
    const next = [...tracks];
    next[idx] = { ...next[idx], [field]: value };
    updateField('tracks', next);
  };

  const addTrack = () => {
    updateField('tracks', [...tracks, { title: '', artist: '', url: '' }]);
  };

  const removeTrack = (idx: number) => {
    updateField(
      'tracks',
      tracks.filter((_, i) => i !== idx)
    );
    if (showPicker === idx) setShowPicker(null);
  };

  /** 上傳音檔到 R2 */
  const handleUpload = async (idx: number, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    setUploadingIdx(idx);
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${apiBase}/api/root/assets`, {
        method: 'POST',
        headers,
        body: formData,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const json = (await res.json()) as { ok: boolean; data: { key: string } };
      if (json.ok) {
        updateTrack(idx, 'url', `/api/root/assets/${json.data.key}`);
        // 自動填入標題（如果還沒填）
        if (!tracks[idx]?.title) {
          const name = file.name.replace(/\.[^.]+$/, '');
          updateTrack(idx, 'title', name);
        }
      }
    } catch (err) {
      console.error('Audio upload error:', err);
    } finally {
      setUploadingIdx(null);
    }
  };

  /** 從媒體庫選擇 */
  const handlePickFromLibrary = (idx: number, key: string) => {
    updateTrack(idx, 'url', `/api/root/assets/${key}`);
    setShowPicker(null);
    // 自動填入標題
    if (!tracks[idx]?.title) {
      const name =
        key
          .split('/')
          .pop()
          ?.replace(/\.[^.]+$/, '') || '';
      updateTrack(idx, 'title', name);
    }
  };

  return (
    <>
      <Divider label="曲目列表" />
      {tracks.map((t, i) => (
        <div
          key={i}
          style={{
            border: '1px solid var(--q-line)',
            borderRadius: 8,
            padding: '12px 14px',
            marginBottom: 8,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <Mono v="navy">#{i + 1}</Mono>
            <button
              onClick={() => removeTrack(i)}
              style={{
                padding: '3px 10px',
                fontSize: 10,
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: '0.06em',
                color: 'var(--q-ink-mute)',
                border: '1px solid var(--q-line)',
                borderRadius: 4,
                background: 'transparent',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--q-coral)';
                e.currentTarget.style.borderColor = 'var(--q-coral)';
                e.currentTarget.style.background = 'rgba(214,68,46,0.06)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--q-ink-mute)';
                e.currentTarget.style.borderColor = 'var(--q-line)';
                e.currentTarget.style.background = 'transparent';
              }}
            >
              ✕ 刪除
            </button>
          </div>
          <Field label="title">
            <Input
              value={t.title}
              onChange={(v) => updateTrack(i, 'title', v)}
              placeholder="曲名"
            />
          </Field>
          <Field label="artist">
            <Input
              value={t.artist}
              onChange={(v) => updateTrack(i, 'artist', v)}
              placeholder="演出者"
            />
          </Field>
          <Field label="url">
            <Input
              value={t.url}
              onChange={(v) => updateTrack(i, 'url', v)}
              placeholder="/music/track.mp3"
              mono
            />
          </Field>
          {/* 音檔來源選擇 */}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button
              className="qe-btn"
              style={{ flex: 1, fontSize: 10 }}
              onClick={() => {
                setUploadIdx(i);
                fileInputRef.current?.click();
              }}
              disabled={uploadingIdx !== null}
              aria-busy={uploadingIdx === i}
            >
              {uploadingIdx === i ? (
                <UploadSpinner label="上傳中" />
              ) : (
                '↑ 上傳音檔'
              )}
            </button>
            <button
              className="qe-btn"
              style={{ flex: 1, fontSize: 10 }}
              onClick={() => setShowPicker(showPicker === i ? null : i)}
            >
              ☰ 從媒體庫選擇
            </button>
          </div>

          {/* 內嵌媒體庫 picker */}
          {showPicker === i && (
            <div
              style={{
                marginTop: 8,
                border: '1px solid var(--q-line)',
                borderRadius: 8,
                overflow: 'auto',
                maxHeight: 360,
              }}
            >
              <RootMediaLibrary
                apiBase={apiBase}
                token={token}
                mode="picker"
                filterType="audio"
                onPick={(key) => handlePickFromLibrary(i, key)}
              />
            </div>
          )}
        </div>
      ))}

      {/* 隱藏的 file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && uploadIdx !== null) {
            handleUpload(uploadIdx, file);
          }
          e.target.value = '';
        }}
      />

      <button
        onClick={addTrack}
        className="qe-btn"
        style={{
          width: '100%',
          padding: '10px',
          borderStyle: 'dashed',
          color: 'var(--q-navy)',
          fontSize: 11,
        }}
      >
        + 新增曲目
      </button>
    </>
  );
}

// ── 訪客計數編輯器 ──────────────────────────────────────────

function VisitorEditor({
  visitorApiUrl,
  token,
}: {
  visitorApiUrl: string;
  token: string;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [resetValue, setResetValue] = useState('');
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [msg, setMsg] = useState('');

  // 載入目前計數
  React.useEffect(() => {
    if (!visitorApiUrl) return;
    fetch(`${visitorApiUrl}/api/visitor/count`)
      .then((r) => r.json() as Promise<{ totalVisitors?: number }>)
      .then((d) => setCount(d.totalVisitors ?? 0))
      .catch(() => setCount(null));
  }, [visitorApiUrl]);

  // 未設定 visitor API URL 時顯示提示
  if (!visitorApiUrl) {
    return (
      <>
        <Divider label="設定" />
        <div
          style={{
            padding: '12px 0',
            color: 'var(--q-ink-mute)',
            fontSize: 12,
          }}
        >
          未設定{' '}
          <code
            style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}
          >
            PUBLIC_VISITOR_API_URL
          </code>{' '}
          環境變數， 無法連線到訪客計數 Worker。
        </div>
      </>
    );
  }

  const handleReset = async () => {
    setResetting(true);
    setMsg('');
    try {
      const value = resetValue.trim() ? parseInt(resetValue, 10) : 0;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${visitorApiUrl}/api/visitor/reset`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ value: isNaN(value) ? 0 : value }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        totalVisitors?: number;
        error?: string;
      };
      if (json.ok) {
        setCount(json.totalVisitors ?? 0);
        setMsg(`✓ 已重置為 ${json.totalVisitors}`);
        setConfirmReset(false);
        setResetValue('');
      } else {
        setMsg(`✗ ${json.error || '重置失敗'}`);
      }
    } catch (err) {
      setMsg('✗ 網路錯誤');
    }
    setResetting(false);
    setTimeout(() => setMsg(''), 3000);
  };

  return (
    <>
      <Divider label="目前狀態" />
      <Field label="total visitors">
        <Mono style={{ fontSize: 24 }}>
          {count !== null ? count.toLocaleString() : '---'}
        </Mono>
      </Field>
      <div
        style={{ padding: '8px 0', color: 'var(--q-ink-mute)', fontSize: 11 }}
      >
        數據來源：eternity-visitor-counter Worker (KV)
        <br />
        計數自動管理，每個 IP+UA 組合 24 小時內只算一次
      </div>

      <Divider label="危險操作" />
      <button
        onClick={() => setConfirmReset(true)}
        style={{
          width: '100%',
          padding: '10px 16px',
          border: '1px solid var(--q-coral)',
          borderRadius: 8,
          background: 'transparent',
          color: 'var(--q-coral)',
          cursor: 'pointer',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          letterSpacing: '0.08em',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(214,68,46,0.08)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <span style={{ fontSize: 13 }}>⚠</span>
        重置訪客計數
      </button>

      {/* ─── 確認 Dialog ─── */}
      {confirmReset && (
        <div
          className="qe-modal-overlay"
          onClick={() => setConfirmReset(false)}
          style={{ zIndex: 100 }}
        >
          <div
            className="qe-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 400, width: '90vw' }}
          >
            {/* Header */}
            <div
              style={{
                padding: '18px 22px 14px',
                borderBottom: '1px solid var(--q-line)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span style={{ fontSize: 18 }}>⚠</span>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase' as const,
                  color: 'var(--q-coral)',
                  fontWeight: 600,
                }}
              >
                確認重置訪客計數
              </span>
            </div>

            {/* Body */}
            <div style={{ padding: '18px 22px' }}>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--q-ink-soft)',
                  lineHeight: 1.6,
                  marginBottom: 16,
                }}
              >
                此操作會將訪客計數器歸零（或設定為指定值），
                <strong style={{ color: 'var(--q-coral)' }}>無法復原</strong>。
              </div>
              <Field label="重置為（留空 = 歸零）">
                <Input
                  value={resetValue}
                  onChange={setResetValue}
                  placeholder="0"
                  mono
                />
              </Field>
            </div>

            {/* Footer */}
            <div
              style={{
                padding: '14px 22px 18px',
                borderTop: '1px solid var(--q-line)',
                display: 'flex',
                gap: 10,
                justifyContent: 'flex-end',
              }}
            >
              <button
                className="qe-btn"
                onClick={() => {
                  setConfirmReset(false);
                  setResetValue('');
                }}
                style={{ minWidth: 80 }}
              >
                取消
              </button>
              <button
                className="qe-btn"
                onClick={handleReset}
                disabled={resetting}
                style={{
                  minWidth: 100,
                  background: 'var(--q-coral)',
                  borderColor: 'var(--q-coral)',
                  color: '#fff',
                  fontWeight: 600,
                }}
              >
                {resetting ? '重置中...' : '確認重置'}
              </button>
            </div>
          </div>
        </div>
      )}
      {msg && (
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            color: msg.startsWith('✓') ? 'var(--q-navy)' : 'var(--q-coral)',
          }}
        >
          {msg}
        </div>
      )}
    </>
  );
}

// ── 每日名言編輯器 ──────────────────────────────────────────

function QuoteEditor({
  content,
  updateField,
}: {
  content: Record<string, unknown>;
  updateField: (key: string, value: unknown) => void;
}) {
  const [lang, setLang] = useState<'zh' | 'en'>('zh');

  const quotesZh =
    (content.quotes_zh as { text: string; author: string }[]) || [];
  const quotesEn =
    (content.quotes_en as { text: string; author: string }[]) || [];
  const quotes = lang === 'zh' ? quotesZh : quotesEn;
  const fieldKey = lang === 'zh' ? 'quotes_zh' : 'quotes_en';

  const updateQuote = (idx: number, field: string, value: string) => {
    const next = [...quotes];
    next[idx] = { ...next[idx], [field]: value };
    updateField(fieldKey, next);
  };

  const addQuote = () => {
    updateField(fieldKey, [...quotes, { text: '', author: '' }]);
  };

  const removeQuote = (idx: number) => {
    updateField(
      fieldKey,
      quotes.filter((_, i) => i !== idx)
    );
  };

  return (
    <>
      <Divider label="名言池" />
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          className={`qe-btn ${lang === 'zh' ? 'qe-btn--primary' : ''}`}
          onClick={() => setLang('zh')}
          style={{ flex: 1, fontSize: 11 }}
        >
          繁中 ({quotesZh.length})
        </button>
        <button
          className={`qe-btn ${lang === 'en' ? 'qe-btn--primary' : ''}`}
          onClick={() => setLang('en')}
          style={{ flex: 1, fontSize: 11 }}
        >
          EN ({quotesEn.length})
        </button>
      </div>

      {quotes.map((q, i) => (
        <div
          key={`${lang}-${i}`}
          style={{
            border: '1px solid var(--q-line)',
            borderRadius: 8,
            padding: '12px 14px',
            marginBottom: 8,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <Mono v="navy">#{i + 1}</Mono>
            <button
              onClick={() => removeQuote(i)}
              style={{
                padding: '3px 10px',
                fontSize: 10,
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: '0.06em',
                color: 'var(--q-ink-mute)',
                border: '1px solid var(--q-line)',
                borderRadius: 4,
                background: 'transparent',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--q-coral)';
                e.currentTarget.style.borderColor = 'var(--q-coral)';
                e.currentTarget.style.background = 'rgba(214,68,46,0.06)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--q-ink-mute)';
                e.currentTarget.style.borderColor = 'var(--q-line)';
                e.currentTarget.style.background = 'transparent';
              }}
            >
              ✕ 刪除
            </button>
          </div>
          <Field label="text">
            <textarea
              className="qe-input"
              value={q.text}
              onChange={(e) => updateQuote(i, 'text', e.target.value)}
              rows={2}
              placeholder={lang === 'zh' ? '名言內容...' : 'Quote text...'}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </Field>
          <Field label="author">
            <Input
              value={q.author}
              onChange={(v) => updateQuote(i, 'author', v)}
              placeholder={lang === 'zh' ? '作者' : 'Author'}
            />
          </Field>
        </div>
      ))}

      <button
        onClick={addQuote}
        className="qe-btn"
        style={{
          width: '100%',
          padding: '10px',
          borderStyle: 'dashed',
          color: 'var(--q-navy)',
          fontSize: 11,
        }}
      >
        + 新增{lang === 'zh' ? '中文' : '英文'}名言
      </button>
    </>
  );
}

// ── 隨機探索 Portal 編輯器 ─────────────────────────────────

function PortalEditor() {
  return (
    <>
      <Divider label="說明" />
      <div
        style={{
          padding: '12px 0',
          color: 'var(--q-ink-soft)',
          fontSize: 13,
          lineHeight: 1.7,
        }}
      >
        🚧 <strong>建設中</strong> — 此 widget
        目前會隨機導向文件站的某個區域主頁。
        <br />
        <br />
        <span style={{ fontSize: 11, color: 'var(--q-ink-mute)' }}>
          Epic 2 計劃：整合探索者記錄系統，可導向使用者已解鎖的頁面。
          需要文件站的會員系統完成後才能實作。
        </span>
      </div>
    </>
  );
}

// ── 網站狀態編輯器 ──────────────────────────────────────────

function StatusEditor({
  content,
  updateField,
}: {
  content: Record<string, unknown>;
  updateField: (key: string, value: unknown) => void;
}) {
  const items =
    (content.items as { key: string; value: string; color?: string }[]) || [];
  const colorOptions = [
    { value: '', label: '預設' },
    { value: 'green', label: '🟢 綠' },
    { value: 'yellow', label: '🟡 黃' },
    { value: 'red', label: '🔴 紅' },
    { value: 'navy', label: '🔵 藍' },
  ];

  const updateItem = (idx: number, field: string, value: string) => {
    const next = [...items];
    next[idx] = { ...next[idx], [field]: value };
    updateField('items', next);
  };

  const addItem = () => {
    updateField('items', [...items, { key: '', value: '', color: 'green' }]);
  };

  const removeItem = (idx: number) => {
    updateField(
      'items',
      items.filter((_, i) => i !== idx)
    );
  };

  return (
    <>
      <Divider label="狀態項目" />
      {items.map((item, i) => (
        <div
          key={i}
          style={{
            border: '1px solid var(--q-line)',
            borderRadius: 8,
            padding: '12px 14px',
            marginBottom: 8,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <Mono v="navy">#{i + 1}</Mono>
            <button
              onClick={() => removeItem(i)}
              style={{
                padding: '3px 10px',
                fontSize: 10,
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: '0.06em',
                color: 'var(--q-ink-mute)',
                border: '1px solid var(--q-line)',
                borderRadius: 4,
                background: 'transparent',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--q-coral)';
                e.currentTarget.style.borderColor = 'var(--q-coral)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--q-ink-mute)';
                e.currentTarget.style.borderColor = 'var(--q-line)';
              }}
            >
              ✕ 刪除
            </button>
          </div>
          <Field label="key（標籤名）">
            <Input
              value={item.key}
              onChange={(v) => updateItem(i, 'key', v)}
              placeholder="STATUS"
              mono
            />
          </Field>
          <Field label="value（顯示值）">
            <Input
              value={item.value}
              onChange={(v) => updateItem(i, 'value', v)}
              placeholder="Online"
            />
          </Field>
          <Field label="color（指示燈）">
            <select
              className="qe-select"
              value={item.color || ''}
              onChange={(e) => updateItem(i, 'color', e.target.value)}
            >
              {colorOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      ))}
      <button
        onClick={addItem}
        className="qe-btn"
        style={{
          width: '100%',
          padding: '10px',
          borderStyle: 'dashed',
          color: 'var(--q-navy)',
          fontSize: 11,
        }}
      >
        + 新增狀態項目
      </button>
    </>
  );
}

// ── U.E.P 角色編輯器 ───────────────────────────────────────

function UEPEditor({
  content,
  updateField,
}: {
  content: Record<string, unknown>;
  updateField: (key: string, value: unknown) => void;
}) {
  const currentImage = (content.image as string) || '/uep/Show.webp';
  const availableImages = [
    { path: '/uep/Show.webp', name: 'Show', desc: '預設展示姿勢' },
    { path: '/uep/Fence.webp', name: 'Fence', desc: '拿著雨傘' },
    { path: '/uep/Lil.webp', name: 'Lil', desc: '小版本' },
    { path: '/uep/Peek.webp', name: 'Peek', desc: '探頭' },
    { path: '/uep/Poke.webp', name: 'Poke', desc: '戳戳' },
  ];

  return (
    <>
      <Divider label="角色圖片" />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          marginBottom: 12,
        }}
      >
        {availableImages.map((img) => {
          const isActive = currentImage === img.path;
          return (
            <button
              key={img.path}
              onClick={() => updateField('image', img.path)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                border: isActive
                  ? '1px solid var(--q-navy)'
                  : '1px solid var(--q-line)',
                borderRadius: 6,
                background: isActive ? 'rgba(39,57,108,0.06)' : 'transparent',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                width: '100%',
                textAlign: 'left',
              }}
            >
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--q-navy)' : 'var(--q-ink)',
                  minWidth: 50,
                }}
              >
                {img.name}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--q-ink-mute)',
                }}
              >
                {img.desc}
              </span>
              {isActive && (
                <span
                  style={{
                    marginLeft: 'auto',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    color: 'var(--q-navy)',
                  }}
                >
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>

      <Field label="目前路徑">
        <Input value={currentImage} onChange={() => {}} disabled mono />
      </Field>

      <Divider label="互動設定" />
      <div
        style={{
          padding: '8px 0',
          color: 'var(--q-ink-mute)',
          fontSize: 11,
          lineHeight: 1.6,
        }}
      >
        點擊角色會觸發 squint 效果並隨機播放 pinch 音效。
        <br />
        音效來源：
        <code style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          /se/pinch/
        </code>{' '}
        (6 個 .wav 檔)
      </div>
    </>
  );
}
