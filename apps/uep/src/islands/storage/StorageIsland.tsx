/**
 * Storage Island —「便條紙」（Epic 2 S9 的第五座、也是最後一座浮島）
 *
 * 功能定位（艾斯維爾 2026-07-21 定案）：
 * - 隨手記事：便條列表 + inline 編輯 + 島內局部刪除確認
 * - 便條本體走 ProgressState 跨裝置同步（S9-A.1 已落地）
 * - 釘選功能（拖出到頁面內容）分在 S9-A.4/.5/.6 逐步接上
 *
 * 島 header 由 DraggableIsland 提供（便條紙 title + ✎ icon + 收合鈕）。
 * 本元件負責 body：位置條 + 便條列表 + 輸入區。
 *
 * 便條紙視覺語彙移植自 Eternity-Design/components/storage-base.jsx:244
 * Scratchpad 原型：膠帶條、傾斜便條、紙質陰影、暖黃色系。
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  STORAGE_NOTE_MAX,
  STORAGE_NOTE_TEXT_MAX,
  getProgressManager,
  useProgress,
} from '../../progress';
import type { StorageNote } from '../../progress';
import { ZONE_LABELS, useCurrentLocation } from '../useCurrentLocation';

import './StorageIsland.css';

/** 便條排序：updatedAt desc（最近編輯排最上） */
function sortNotes(notes: StorageNote[]): StorageNote[] {
  return [...notes].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export default function StorageIsland() {
  const progress = useProgress();
  const location = useCurrentLocation();
  const notes = useMemo(
    () => sortNotes(progress.storageNotes),
    [progress.storageNotes]
  );
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  /** 當前 inline 編輯的便條 id（null = 無編輯中） */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** 當前展開刪除確認的便條 id（null = 無確認中） */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const atCap = notes.length >= STORAGE_NOTE_MAX;

  /* ── 新增便條 ── */
  const handleAdd = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const text = input.trim();
      if (!text) return;
      const ok = getProgressManager().addStorageNote(text);
      if (!ok) {
        setInputError(
          notes.length >= STORAGE_NOTE_MAX
            ? `便條已滿（${STORAGE_NOTE_MAX}）`
            : '無法新增'
        );
        return;
      }
      setInput('');
      setInputError(null);
    },
    [input, notes.length]
  );

  return (
    <div className="uep-stoland">
      {/* 當前位置條——便條島跨區共用，讓使用者一眼認出「在哪一 zone 記」 */}
      <div className="uep-stoland__location" aria-live="polite">
        <span className="uep-stoland__location-icon" aria-hidden>
          ◈
        </span>
        <span className="uep-stoland__location-label">
          {location.zone
            ? (ZONE_LABELS[location.zone] ?? location.zone)
            : '起始頁'}
        </span>
        {location.pageLabel && (
          <span
            className="uep-stoland__location-page"
            title={location.pageLabel}
          >
            {location.pageLabel.replace(/\s*[·\-–]\s*邊際世界\s*$/u, '')}
          </span>
        )}
      </div>

      {/* 便條列表 */}
      <div className="uep-stoland__list" role="list">
        {notes.length === 0 && (
          <div className="uep-stoland__empty">還沒寫下任何東西。</div>
        )}
        {notes.map((note, i) => (
          <NoteCard
            key={note.id}
            note={note}
            isLatest={i === 0}
            isEditing={editingId === note.id}
            isConfirmingDelete={confirmDeleteId === note.id}
            onStartEdit={() => setEditingId(note.id)}
            onEndEdit={() => setEditingId(null)}
            onRequestDelete={() => setConfirmDeleteId(note.id)}
            onCancelDelete={() => setConfirmDeleteId(null)}
            onConfirmDelete={() => {
              getProgressManager().removeStorageNote(note.id);
              setConfirmDeleteId(null);
              if (editingId === note.id) setEditingId(null);
            }}
          />
        ))}
      </div>

      {/* 便條數量與 cap 提示 */}
      <div className="uep-stoland__meta">
        <span>
          {notes.length} / {STORAGE_NOTE_MAX}
        </span>
        {inputError && (
          <span className="uep-stoland__meta-error">{inputError}</span>
        )}
      </div>

      {/* 輸入區 */}
      <form className="uep-stoland__form" onSubmit={handleAdd}>
        <span className="uep-stoland__prompt" aria-hidden>
          ›
        </span>
        <input
          type="text"
          value={input}
          maxLength={STORAGE_NOTE_TEXT_MAX}
          disabled={atCap}
          onChange={(e) => {
            setInput(e.target.value);
            if (inputError) setInputError(null);
          }}
          placeholder={atCap ? '便條已滿' : '寫下一個想法…'}
          aria-label="新增便條"
          className="uep-stoland__input"
        />
        <button
          type="submit"
          disabled={atCap || !input.trim()}
          className="uep-stoland__submit"
        >
          + 貼上
        </button>
      </form>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
 * 單張便條卡
 * ───────────────────────────────────────────────────────── */

interface NoteCardProps {
  note: StorageNote;
  isLatest: boolean;
  isEditing: boolean;
  isConfirmingDelete: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

function NoteCard({
  note,
  isLatest,
  isEditing,
  isConfirmingDelete,
  onStartEdit,
  onEndEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: NoteCardProps) {
  const [draft, setDraft] = useState(note.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /* 進入編輯時同步 draft + 自動 focus + 選取全文 */
  useEffect(() => {
    if (isEditing) {
      setDraft(note.text);
      // focus 讓使用者立刻能打字；不 select 全文——避免不小心整段被覆蓋
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [isEditing, note.text]);

  function commitEdit() {
    const text = draft.trim();
    if (!text || text === note.text) {
      onEndEdit();
      return;
    }
    getProgressManager().updateStorageNote(note.id, text);
    onEndEdit();
  }

  function cancelEdit() {
    setDraft(note.text);
    onEndEdit();
  }

  const classes = [
    'uep-stoland__note',
    isLatest ? 'is-latest' : '',
    isEditing ? 'is-editing' : '',
    isConfirmingDelete ? 'is-confirming' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      role="listitem"
      className={classes}
      style={{ transform: `rotate(${note.tilt}deg)` }}
    >
      {isConfirmingDelete ? (
        /* 島內局部刪除確認——不用 __uepDialogManager（那是全螢幕） */
        <div className="uep-stoland__confirm">
          <span className="uep-stoland__confirm-msg">刪除這張便條？</span>
          <div className="uep-stoland__confirm-actions">
            <button
              type="button"
              onClick={onConfirmDelete}
              className="uep-stoland__confirm-yes"
            >
              刪除
            </button>
            <button
              type="button"
              onClick={onCancelDelete}
              className="uep-stoland__confirm-no"
            >
              取消
            </button>
          </div>
        </div>
      ) : isEditing ? (
        <textarea
          ref={textareaRef}
          value={draft}
          maxLength={STORAGE_NOTE_TEXT_MAX}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commitEdit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelEdit();
            }
          }}
          className="uep-stoland__note-textarea"
          aria-label="編輯便條"
        />
      ) : (
        <>
          <button
            type="button"
            onClick={onStartEdit}
            className="uep-stoland__note-text"
            aria-label={`編輯便條：${note.text}`}
          >
            {note.text}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRequestDelete();
            }}
            className="uep-stoland__note-delete"
            aria-label="刪除便條"
            title="刪除"
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}
