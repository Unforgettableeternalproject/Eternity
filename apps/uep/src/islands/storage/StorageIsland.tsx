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
import { createPortal } from 'react-dom';

import {
  STORAGE_NOTE_MAX,
  STORAGE_NOTE_TEXT_MAX,
  getProgressManager,
  useProgress,
} from '../../progress';
import type { StorageNote } from '../../progress';
import { ZONE_LABELS, useCurrentLocation } from '../useCurrentLocation';

import {
  DRAG_THRESHOLD,
  commitPin,
  navigateToPinned,
  resolveDropTarget,
} from './dragToPin';
import { usePinnedNotes } from './usePinnedNotes';

import './StorageIsland.css';

/**
 * 便條排序：已釘選永遠在最上（艾斯維爾 07/24 驗收定案），
 * 同組內 updatedAt desc（最近編輯排前）。
 */
function sortNotes(
  notes: StorageNote[],
  pinnedIds: ReadonlySet<string>
): StorageNote[] {
  return [...notes].sort((a, b) => {
    const ap = pinnedIds.has(a.id);
    const bp = pinnedIds.has(b.id);
    if (ap !== bp) return ap ? -1 : 1;
    return a.updatedAt < b.updatedAt ? 1 : -1;
  });
}

export default function StorageIsland() {
  const progress = useProgress();
  const location = useCurrentLocation();
  const pinned = usePinnedNotes();
  const pinnedIds = useMemo(
    () => new Set(pinned.map((p) => p.noteId)),
    [pinned]
  );
  const notes = useMemo(
    () => sortNotes(progress.storageNotes, pinnedIds),
    [progress.storageNotes, pinnedIds]
  );
  /** 「最新放大」給最近編輯的未釘選那張——已釘選暗掉又放大會很怪 */
  const latestId = useMemo(
    () => notes.find((n) => !pinnedIds.has(n.id))?.id ?? null,
    [notes, pinnedIds]
  );
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  /** 當前 inline 編輯的便條 id（null = 無編輯中） */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** 當前展開刪除確認的便條 id（null = 無確認中） */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const atCap = notes.length >= STORAGE_NOTE_MAX;

  /* 刪除確認在任何失焦時收起（艾斯維爾 07/24：不只點另一張的 ×）——
   * capture-phase pointerdown，點到確認中卡片以外的任何地方就取消 */
  useEffect(() => {
    if (!confirmDeleteId || typeof document === 'undefined') return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest(`[data-note-id="${confirmDeleteId}"]`)) {
        setConfirmDeleteId(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, true);
  }, [confirmDeleteId]);

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
            // tooltip 給完整階層（如「第一章 / 殘響之弧 / 某節」）——
            // pageTrail 由 Reader 路由解析發佈（pageContext）
            title={[...location.pageTrail, location.pageLabel].join(' / ')}
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
        {notes.map((note) => {
          const isPinned = pinnedIds.has(note.id);
          const pinnedMeta = isPinned
            ? (pinned.find((p) => p.noteId === note.id) ?? null)
            : null;
          return (
            <NoteCard
              key={note.id}
              note={note}
              isLatest={note.id === latestId}
              isPinned={isPinned}
              pinnedMeta={pinnedMeta}
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
          );
        })}
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
  isPinned: boolean;
  pinnedMeta: import('./pinnedStore').PinnedNote | null;
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
  isPinned,
  pinnedMeta,
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
  /** Esc 按下時 draft 有未存變更 → 展開「丟棄變更？」確認（07/24 驗收） */
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const discardActionsRef = useRef<HTMLDivElement>(null);

  /* ── 拖曳釘選（未編輯 / 未確認刪除 / 未釘 才可拖） ──
   * ghost 定位不走 React state——pointermove 每 frame setState 會整卡
   * re-render，實測拖曳明顯卡頓（艾斯維爾 07/24 回饋）。改 ref 直寫
   * transform，React 只管 ghost 的 mount/unmount。 */
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const positionGhost = useCallback((x: number, y: number) => {
    lastPointRef.current = { x, y };
    const g = ghostRef.current;
    if (g) {
      // translate 走 compositor，不觸發 layout；-3deg 傾斜沿設計稿
      g.style.transform = `translate(${x - 60}px, ${y - 20}px) rotate(-3deg)`;
    }
  }, []);

  /* 進入編輯時同步 draft + 自動 focus + 選取全文 */
  useEffect(() => {
    if (isEditing) {
      setDraft(note.text);
      setDiscardPrompt(false);
      // focus 讓使用者立刻能打字；不 select 全文——避免不小心整段被覆蓋
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [isEditing, note.text]);

  function commitEdit() {
    setDiscardPrompt(false);
    const text = draft.trim();
    if (!text || text === note.text) {
      onEndEdit();
      return;
    }
    getProgressManager().updateStorageNote(note.id, text);
    onEndEdit();
  }

  function cancelEdit() {
    setDiscardPrompt(false);
    setDraft(note.text);
    onEndEdit();
  }

  /** Esc：沒改動直接退出；有改動先問（不明顯的還原容易誤丟內容） */
  function requestCancelEdit() {
    if (draft === note.text) {
      cancelEdit();
      return;
    }
    setDiscardPrompt(true);
  }

  /* ── pointer 拖曳（未編輯 / 未確認 / 未釘 才可觸發） ── */
  function handlePointerDown(e: React.PointerEvent) {
    if (isEditing || isConfirmingDelete || isPinned) return;
    // 讓 delete 鈕與內文按鈕仍能收到 click——這邊只記錄起點
    dragOriginRef.current = { x: e.clientX, y: e.clientY };
  }

  function handlePointerMove(e: React.PointerEvent) {
    const origin = dragOriginRef.current;
    if (!origin) return;
    const dx = e.clientX - origin.x;
    const dy = e.clientY - origin.y;
    if (!dragging && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
    if (!dragging) {
      // 超過門檻 → 進入拖曳態，捕獲 pointer 避免離開卡片就斷
      setDragging(true);
      try {
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      } catch {
        /* 靜默；捕獲失敗仍能繼續追 pointermove（會較不精準） */
      }
    }
    positionGhost(e.clientX, e.clientY);
  }

  function handlePointerUp(e: React.PointerEvent) {
    const origin = dragOriginRef.current;
    dragOriginRef.current = null;
    if (!dragging) return; // 沒進入拖曳態 → 走原本的 click（進編輯）
    setDragging(false);
    lastPointRef.current = null;
    // 落地
    if (!origin) return;
    const resolution = resolveDropTarget(e.clientX, e.clientY);
    commitPin(note.id, resolution);
  }

  function handlePointerCancel() {
    dragOriginRef.current = null;
    setDragging(false);
    lastPointRef.current = null;
  }

  /* ── 點暗掉便條 → 導向釘選頁 ── */
  function handlePinnedClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!pinnedMeta) return;
    navigateToPinned(pinnedMeta);
  }

  const classes = [
    'uep-stoland__note',
    isLatest ? 'is-latest' : '',
    isEditing ? 'is-editing' : '',
    isConfirmingDelete ? 'is-confirming' : '',
    isPinned ? 'is-pinned' : '',
    dragging ? 'is-dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      role="listitem"
      data-note-id={note.id}
      className={classes}
      style={{ transform: `rotate(${note.tilt}deg)` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {/* 拖曳中的 ghost：跟隨 pointer 的視覺回饋。
          ⚠️ 必須 portal 到 body——便條卡有 transform（rotate tilt），
          transform 祖先會讓 fixed 退化成相對定位，加上列表 overflow
          裁切，ghost 在島內根本顯示不出來（S9-A 驗收根因 B）。 */}
      {dragging &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={(el) => {
              ghostRef.current = el;
              // mount 當下就對到最後的 pointer 位置（進拖曳態的那一步）
              const p = lastPointRef.current;
              if (el && p) {
                el.style.transform = `translate(${p.x - 60}px, ${p.y - 20}px) rotate(-3deg)`;
              }
            }}
            className="uep-stoland__note-ghost"
            aria-hidden
          >
            {note.text.slice(0, 30)}
            {note.text.length > 30 && '…'}
          </div>,
          document.body
        )}

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
        <>
          <textarea
            ref={textareaRef}
            value={draft}
            maxLength={STORAGE_NOTE_TEXT_MAX}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => {
              // focus 移進「丟棄變更」確認鈕 → 不能先 commit 搶走語意
              if (
                discardActionsRef.current?.contains(e.relatedTarget as Node)
              ) {
                return;
              }
              commitEdit();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitEdit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                requestCancelEdit();
              }
            }}
            className="uep-stoland__note-textarea"
            aria-label="編輯便條"
          />
          {discardPrompt ? (
            <div className="uep-stoland__confirm" ref={discardActionsRef}>
              <span className="uep-stoland__confirm-msg">丟棄未存的變更？</span>
              <div className="uep-stoland__confirm-actions">
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="uep-stoland__confirm-yes"
                >
                  丟棄
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDiscardPrompt(false);
                    requestAnimationFrame(() => textareaRef.current?.focus());
                  }}
                  className="uep-stoland__confirm-no"
                >
                  繼續編輯
                </button>
              </div>
            </div>
          ) : (
            <span className="uep-stoland__edit-hint" aria-hidden>
              Enter 儲存 · Esc 取消
            </span>
          )}
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={isPinned ? handlePinnedClick : onStartEdit}
            className="uep-stoland__note-text"
            aria-label={
              isPinned
                ? `前往釘選位置：${note.text}（${pinnedMeta?.pageLabel ?? ''}）`
                : `編輯便條：${note.text}`
            }
            title={
              isPinned
                ? `這張已釘在「${pinnedMeta?.pageLabel ?? '某頁'}」，點擊前往`
                : undefined
            }
          >
            {note.text}
          </button>
          {/* 已釘的便條不再顯示刪除鈕（要拆需先在頁面上拆除） */}
          {!isPinned && (
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
          )}
        </>
      )}
    </div>
  );
}
