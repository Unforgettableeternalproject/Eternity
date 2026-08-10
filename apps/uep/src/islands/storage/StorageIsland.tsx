/**
 * Storage Island —「便條紙」（Epic 2 S9 的第五座、也是最後一座浮島）
 *
 * 功能定位（艾斯維爾 2026-07-21 定案）：
 * - 隨手記事：便條列表 + inline 編輯 + 島內局部刪除確認
 * - 便條本體走 ProgressState 跨裝置同步（S9-A.1 已落地）
 * - 釘選功能（拖出到頁面內容）分在 S9-A.4/.5/.6 逐步接上
 *
 * 視覺（S9-C.5，v2 設計稿提案 A「一整張紙」）：整座島就是一張貼在頁面上
 * 的紙——頂端膠帶固定、底緣是撕開的鋸齒、紙紋壓在最上層，白框 header
 * 消失，標題直接寫在紙上並兼任拖曳把手。
 *
 * ⚠️ 設計稿的手寫體（Long Cang）不採用——艾斯維爾 2026-07-25 指定不要
 * 特殊字體，標題與輸入都走站內既有的 --font-serif-tc。
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
import { getSetting } from '../../lib/uepSettings';
import { useIslandChrome } from '../islandChrome';
import { useCurrentLocation } from '../useCurrentLocation';

import {
  DRAG_THRESHOLD,
  commitPin,
  isUnpinDropTarget,
  navigateToPinned,
  resolveDropTarget,
} from './dragToPin';
import { formatCapturedAt, formatZoneLabel } from './noteMeta';
import { usePinnedNotes } from './usePinnedNotes';
import { subscribeUnlockNotice } from './unlockNotice';

import type { StorageUnlockNotice } from './unlockNotice';

import type { GrabOffset } from './dragToPin';

import islandCss from './StorageIsland.css?inline';
import { useDeferredStyle } from '../useDeferredStyle';

/**
 * 拖曳 ghost 左上角相對指標的偏移——ghost 大致在指標的左上方，讓使用者
 * 看得見游標下方的落點。放開時 `resolveDropTarget` 要吃同一組偏移，
 * 釘上去的便條左上角才會落在 ghost 剛剛的位置（見 {@link GrabOffset}）。
 */
const GHOST_GRAB: GrabOffset = { dx: -60, dy: -20 };

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

/**
 * 去除 pageLabel 尾端的站名（document.title fallback 才會帶），
 * 與當前位置條的顯示規則一致——地點小標的快照要存「使用者當下看到的
 * 那個名稱」，不是帶著站名尾巴的原始字串。
 */
function stripSiteSuffix(label: string): string {
  return label.replace(/\s*[·\-–]\s*邊際世界\s*$/u, '');
}

/** Fence 探頭的四個角落，每次通知隨機挑一個 */
const PEEK_CORNERS = ['tl', 'tr', 'bl', 'br'] as const;
type PeekCorner = (typeof PEEK_CORNERS)[number];

/**
 * 卡片自行收走的時間。只管展開後的這張卡——收合狀態的 dock chip 不走
 * 這個計時器，它跟其他提示一樣撐到展開或換頁為止。
 */
const PEEK_TTL_MS = 30_000;

/** 導向解鎖的那篇對話（沿 navigateToPinned 的同頁 pushState 手法） */
function goToDialogue(slug: string): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.pathname = '/storage';
  url.search = '';
  url.searchParams.set('page', slug);
  const target = url.pathname + url.search;
  if (window.location.pathname === url.pathname) {
    // 同 pathname 的子頁切換：pushState 不會產生 popstate（規範限制），
    // 必須手動派一個讓 useZoneRouter 接手載入內容。
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  } else {
    window.location.assign(target);
  }
}

/**
 * UEP 從島的角落斜斜探出來，說有新的對話可以聊了。
 *
 * 對話 gate 未通過時整張從列表消失，解鎖那一刻因此毫無動靜——這張卡是
 * 補回來的那一半。只提一篇（多篇同時解鎖時取第一篇），其餘讓讀者自己
 * 在置物空間裡發現。
 */
function UnlockNoticePeek() {
  const [notice, setNotice] = useState<StorageUnlockNotice | null>(null);
  const [corner, setCorner] = useState<PeekCorner>('tr');

  useEffect(
    () =>
      subscribeUnlockNotice((next) => {
        setNotice(next);
        if (next) {
          setCorner(
            PEEK_CORNERS[Math.floor(Math.random() * PEEK_CORNERS.length)]
          );
        }
      }),
    []
  );

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), PEEK_TTL_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;

  return (
    <div
      className={`uep-stoland__peek uep-stoland__peek--${corner}`}
      role="status"
    >
      <img
        src="/uep/Fence.webp"
        alt=""
        aria-hidden
        className="uep-stoland__peek-fence"
      />
      <button
        type="button"
        className="uep-stoland__peek-bubble"
        onClick={() => {
          setNotice(null);
          goToDialogue(notice.slug);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="uep-stoland__peek-lead">欸，有空嗎？</span>
        <span className="uep-stoland__peek-title">{notice.title}</span>
        <span className="uep-stoland__peek-hint">點一下過來找我</span>
      </button>
      <button
        type="button"
        className="uep-stoland__peek-dismiss"
        onClick={() => setNotice(null)}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="關閉通知"
      >
        ×
      </button>
    </div>
  );
}

export default function StorageIsland() {
  useDeferredStyle('storage-island', islandCss);
  const progress = useProgress();
  const chrome = useIslandChrome();
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

  /* 上限走站台設定（/admin/settings），未載入時退回常數 */
  const noteMax = getSetting('note.max', STORAGE_NOTE_MAX);
  const noteTextMax = getSetting('note.textMax', STORAGE_NOTE_TEXT_MAX);
  const atCap = notes.length >= noteMax;

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
          notes.length >= noteMax ? `便條已滿（${noteMax}）` : '無法新增'
        );
        return;
      }
      setInput('');
      setInputError(null);
    },
    [input, notes.length, noteMax]
  );

  return (
    <div className="uep-stoland">
      {/* 把整張紙貼在頁面上的膠帶（純裝飾） */}
      <span className="uep-stoland__tape" aria-hidden />

      {/* 對話解鎖通知——UEP 從某個角落探出來 */}
      <UnlockNoticePeek />

      {/* 紙上的標題＝拖曳把手（設計稿沒有白框 header） */}
      <div className="uep-stoland__masthead" {...chrome.dragHandleProps}>
        <div className="uep-island-title uep-stoland__hand">便條紙</div>
        <div className="uep-stoland__rule" aria-hidden />
      </div>

      {chrome.bare && (
        <button
          type="button"
          className="uep-island-close uep-stoland__close"
          onClick={chrome.requestClose}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="收合便條紙"
          title="收合"
        >
          收起
        </button>
      )}

      {/* 當前位置條——便條島跨區共用，讓使用者一眼認出「在哪一 zone 記」 */}
      <div className="uep-stoland__location" aria-live="polite">
        <span className="uep-stoland__location-icon" aria-hidden>
          ◈
        </span>
        <span className="uep-stoland__location-label">
          {/* 首頁自 07/25 起有專屬 zone id（'home' → 「世界的軸心」），
              null 分支剩下 /admin 等非區域頁，不再是「起始頁」 */}
          {location.zone ? formatZoneLabel(location.zone) : '其他頁面'}
        </span>
        {location.pageLabel && (
          <span
            className="uep-stoland__location-page"
            // tooltip 給完整階層（如「第一章 / 殘響之弧 / 某節」）——
            // pageTrail 由 Reader 路由解析發佈（pageContext）
            title={[...location.pageTrail, location.pageLabel].join(' / ')}
          >
            {stripSiteSuffix(location.pageLabel)}
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
              currentZone={location.zone}
              currentPageLabel={stripSiteSuffix(location.pageLabel)}
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
          {notes.length} / {noteMax}
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
          maxLength={noteTextMax}
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
  /** 目前所在 zone（地點小標勾選時的快照來源），無 zone 時 null */
  currentZone: string | null;
  /** 目前頁面標籤（地點小標勾選時的快照來源） */
  currentPageLabel: string;
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
  currentZone,
  currentPageLabel,
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
  /** 地點／時間小標的 checkbox 容器——focus 移進去時 textarea 的 onBlur 不能搶先 commit */
  const noteTagsRef = useRef<HTMLDivElement>(null);

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
      g.style.transform = `translate(${x + GHOST_GRAB.dx}px, ${y + GHOST_GRAB.dy}px) rotate(-3deg)`;
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

  /** 「地點」小標勾選 → 存下目前 zone + pageLabel 快照；取消勾選 → 清除 */
  function handleToggleLocation(checked: boolean) {
    getProgressManager().setStorageNoteLocation(
      note.id,
      checked ? { zone: currentZone ?? '', pageLabel: currentPageLabel } : null
    );
  }

  /** 「時間」小標勾選 → store 產生使用者時區現實時間快照；取消勾選 → 清除 */
  function handleToggleCapturedAt(checked: boolean) {
    getProgressManager().setStorageNoteCapturedAt(note.id, checked);
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
    /* 放開點還在便條島上 → 取消本次拖曳，不釘選。
     * 拖曳起點本來就在島內，小幅移動後放開（已過 DRAG_THRESHOLD 但沒拖
     * 出島）若照常 commitPin，會在島**後面**留一張看不見的 page 級釘選。
     * 與「把場上便條拖回島上 = 解除釘選」是同一組語意。 */
    if (isUnpinDropTarget(e.clientX, e.clientY)) return;
    // 帶上 GHOST_GRAB：釘上去的便條左上角要對齊放開瞬間 ghost 的左上角，
    // 否則會往右下跳一個抓取偏移量（艾斯維爾 07/25 四驗）
    const resolution = resolveDropTarget(e.clientX, e.clientY, GHOST_GRAB);
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
                el.style.transform = `translate(${p.x + GHOST_GRAB.dx}px, ${p.y + GHOST_GRAB.dy}px) rotate(-3deg)`;
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
            maxLength={getSetting('note.textMax', STORAGE_NOTE_TEXT_MAX)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => {
              const related = e.relatedTarget as Node | null;
              // focus 移進「丟棄變更」確認鈕，或地點／時間小標的 checkbox
              // → 不能先 commit 搶走語意
              if (
                discardActionsRef.current?.contains(related) ||
                noteTagsRef.current?.contains(related)
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
          <div className="uep-stoland__note-tags" ref={noteTagsRef}>
            <label className="uep-stoland__note-tag">
              <input
                type="checkbox"
                aria-label="記錄地點"
                checked={Boolean(note.location)}
                onChange={(e) => handleToggleLocation(e.target.checked)}
              />
              <span className="uep-stoland__note-tag-label">地點</span>
              {note.location && (
                <span className="uep-stoland__note-tag-value">
                  {formatZoneLabel(note.location.zone)}
                  {note.location.pageLabel
                    ? ` · ${note.location.pageLabel}`
                    : ''}
                </span>
              )}
            </label>
            <label className="uep-stoland__note-tag">
              <input
                type="checkbox"
                aria-label="記錄時間"
                checked={Boolean(note.capturedAt)}
                onChange={(e) => handleToggleCapturedAt(e.target.checked)}
              />
              <span className="uep-stoland__note-tag-label">時間</span>
              {note.capturedAt && (
                <span
                  className="uep-stoland__note-tag-value"
                  title={note.capturedAt}
                >
                  {formatCapturedAt(note.capturedAt)}
                </span>
              )}
            </label>
          </div>
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
          {/* 地點／時間小標快照——唯讀展示，勾選編輯只在 isEditing 態進行 */}
          {(note.location || note.capturedAt) && (
            <div className="uep-stoland__note-meta">
              {note.location && (
                <span className="uep-stoland__note-meta-item">
                  ◈ {formatZoneLabel(note.location.zone)}
                  {note.location.pageLabel
                    ? ` · ${note.location.pageLabel}`
                    : ''}
                </span>
              )}
              {note.capturedAt && (
                <span
                  className="uep-stoland__note-meta-item"
                  title={note.capturedAt}
                >
                  {formatCapturedAt(note.capturedAt)}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
