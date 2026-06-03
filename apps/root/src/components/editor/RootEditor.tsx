import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Markdown } from '@tiptap/markdown';
import { MarkdownPaste } from './MarkdownPaste';
import ImagePickerDialog from './ImagePickerDialog';
import RootMediaLibrary from './RootMediaLibrary';
import ConfirmDialog, {
  type ConfirmDialogState,
  DIALOG_CLOSED,
} from './ConfirmDialog';
import AboutEditor from './AboutEditor';
import ContactEditor from './ContactEditor';
import type { ContactData } from './ContactEditor';
import PageTextEditor from './PageTextEditor';
import WidgetEditor from './WidgetEditor';
import type { RootCard } from '../../lib/api';
import {
  Mono,
  Divider,
  Field,
  Input,
  Select,
  Toggle,
  TagEditor,
  OutlineRow,
} from './editorPrimitives';
import { APP_VERSION } from '../../lib/version';
import './RootEditor.css';

// ─── types ──────────────────────────────────────────────────────────
interface RootProject {
  id: string;
  titleZh: string;
  titleEn: string;
  descZh: string;
  descEn: string;
  contentZh: string;
  contentEn: string;
  tags: string[];
  featured: boolean;
  sortOrder: number;
  status: string;
  image: string | null;
  links: {
    demo?: string | null;
    github?: string | null;
    website?: string | null;
  };
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
interface RootUpdate {
  id: string;
  titleZh: string;
  titleEn: string;
  descZh: string;
  descEn: string;
  contentZh: string;
  contentEn: string;
  date: string;
  category: string;
  featured: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
interface RootLink {
  id: string;
  titleZh: string;
  titleEn: string;
  descZh: string;
  descEn: string;
  url: string;
  category: string;
  status: string;
  icon: string | null;
  featured: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
/** 首頁 singleton 內容 */
interface HomepageContent {
  title?: string;
  name?: string;
  subtitle?: string;
  introHeading?: string;
  introContent?: string;
}

/** About singleton 內容 */
interface AboutContent {
  title?: string;
  bio?: string;
  heroTitle?: string;
  heroIntro?: string;
  fullBio?: string;
  avatar?: string;
  facts?: [string, string][];
  skills?: {
    id: string;
    name: string;
    en: string;
    brief: string;
    description: string;
    selfAssessment: string;
  }[];
  experience?: {
    title: string;
    company: string;
    period: string;
    location: string;
    description: string;
    stack: string[];
    current: boolean;
  }[];
  social?: Record<string, string>;
  cta?: { heading?: string; text?: string };
}

/** Currently singleton 內容 */
interface CurrentlyContent {
  working?: string;
  learning?: string;
}

/** 頁面文字 singleton 內容 */
interface PageTextContent {
  heroLabel?: string;
  heroTitle?: string;
  heroIntro?: string;
}

interface EditorProps {
  projects: RootProject[];
  updates: RootUpdate[];
  links: RootLink[];
  homepage: HomepageContent | null;
  about: AboutContent | null;
  aboutEn: AboutContent | null;
  currently: CurrentlyContent | null;
  contact: ContactData | null;
  contactEn: ContactData | null;
  pageHomeZh: PageTextContent | null;
  pageHomeEn: PageTextContent | null;
  pageProjectsZh: PageTextContent | null;
  pageProjectsEn: PageTextContent | null;
  pageUpdatesZh: PageTextContent | null;
  pageUpdatesEn: PageTextContent | null;
  pageLinksZh: PageTextContent | null;
  pageLinksEn: PageTextContent | null;
  pageAboutZh: PageTextContent | null;
  pageAboutEn: PageTextContent | null;
  pageContactZh: PageTextContent | null;
  pageContactEn: PageTextContent | null;
  cards: RootCard[];
  apiBase: string;
  token: string;
  visitorApiUrl?: string;
}

const PAGES = [
  { id: 'pages', num: '00', label: '頁面文字 · Pages' },
  { id: 'about', num: '01', label: '關於 · About' },
  { id: 'projects', num: '02', label: '作品 · Projects' },
  { id: 'updates', num: '03', label: '動態 · Updates' },
  { id: 'links', num: '04', label: '連結 · Links' },
  { id: 'contact', num: '05', label: '聯絡 · Contact' },
  { id: 'media', num: '06', label: '媒體庫 · Media' },
  { id: 'widgets', num: '07', label: '小工具 · Widgets' },
] as const;

// ─── API ────────────────────────────────────────────────────────────
async function apiCall(
  base: string,
  path: string,
  method: string,
  token: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

function NewItemModal({
  title,
  onClose,
  onConfirm,
}: {
  title: string;
  onClose: () => void;
  onConfirm: (id: string) => void;
}) {
  const [id, setId] = useState('');
  return (
    <div className="qe-modal-overlay" onClick={onClose}>
      <div className="qe-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="qe-modal__title">{title}</h3>
        <Field label="id (url slug)">
          <Input value={id} onChange={setId} mono placeholder="my-new-item" />
        </Field>
        <div className="qe-modal__actions">
          <button className="qe-topbar__btn" onClick={onClose}>
            <Mono>cancel</Mono>
          </button>
          <button
            className="qe-topbar__btn qe-topbar__btn--primary"
            disabled={!id.trim()}
            onClick={() => id.trim() && onConfirm(id.trim())}
          >
            <Mono style={{ color: 'inherit' }}>create</Mono>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 色板常數 ──────────────────────────────────────────────────────
const COLOR_SWATCHES = [
  { color: 'var(--q-navy)', label: 'Navy' },
  { color: 'var(--q-coral)', label: 'Coral' },
  { color: '#7dd3fc', label: 'Sky' },
  { color: '#d5b618', label: 'Gold' },
  { color: '#a78bfa', label: 'Violet' },
  { color: '#34d399', label: 'Emerald' },
  { color: '#fb923c', label: 'Orange' },
  { color: '#f87171', label: 'Red' },
];

// ─── TipTap editor with toolbar ─────────────────────────────────────
export function TipTapEditor({
  content,
  onUpdate,
  placeholder,
  apiBase,
  token,
}: {
  content: string;
  onUpdate: (html: string) => void;
  placeholder?: string;
  apiBase: string;
  token: string;
}) {
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [showColorPalette, setShowColorPalette] = useState(false);
  // 工具列狀態追蹤（只在 selectionUpdate 時更新，避免 onTransaction 過於頻繁）
  const [, setToolbarTick] = useState(0);
  // 儲存選取範圍，供 color picker 恢復用
  const savedSelection = useRef<{ from: number; to: number } | null>(null);
  const paletteRef = useRef<HTMLDivElement>(null);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [2, 3] } }),
        Underline,
        Placeholder.configure({ placeholder: placeholder || '開始撰寫內容…' }),
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Image,
        Highlight,
        TextStyle,
        Color,
        Markdown,
        MarkdownPaste,
      ],
      content,
      onUpdate: ({ editor: e }) => {
        onUpdate(e.getHTML());
        setToolbarTick((n) => n + 1);
      },
      onSelectionUpdate: () => setToolbarTick((n) => n + 1),
    },
    []
  );

  // 點擊色板以外的地方關閉色板
  useEffect(() => {
    if (!showColorPalette) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowColorPalette(false);
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [showColorPalette]);

  // sync external content changes (e.g. switching items)
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      const current = editor.getHTML();
      if (content !== current && content !== '<p></p>') {
        editor.commands.setContent(content || '', { emitUpdate: false });
      }
    }
  }, [content, editor]);

  if (!editor) return null;

  const TB = ({
    cmd,
    label,
    active,
    title: btnTitle,
    style: btnStyle,
  }: {
    cmd: () => void;
    label: string;
    active?: boolean;
    title?: string;
    style?: React.CSSProperties;
  }) => (
    <button
      className={`qe-toolbar__btn${active ? ' qe-toolbar__btn--active' : ''}`}
      onMouseDown={(e) => {
        e.preventDefault();
        cmd();
      }}
      title={btnTitle || label}
      style={btnStyle}
    >
      {label}
    </button>
  );

  const currentColor = editor.getAttributes('textStyle').color || '';

  return (
    <div className="qe-tiptap-wrap">
      <div className="qe-toolbar">
        <TB
          cmd={() => editor.chain().focus().toggleBold().run()}
          label="B"
          active={editor.isActive('bold')}
        />
        <TB
          cmd={() => editor.chain().focus().toggleItalic().run()}
          label="I"
          active={editor.isActive('italic')}
        />
        <TB
          cmd={() => editor.chain().focus().toggleUnderline().run()}
          label="U"
          active={editor.isActive('underline')}
        />
        <TB
          cmd={() => editor.chain().focus().toggleStrike().run()}
          label="S"
          active={editor.isActive('strike')}
        />
        <div className="qe-toolbar__sep" />
        <TB
          cmd={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          label="H2"
          active={editor.isActive('heading', { level: 2 })}
        />
        <TB
          cmd={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          label="H3"
          active={editor.isActive('heading', { level: 3 })}
        />
        <TB
          cmd={() => editor.chain().focus().setParagraph().run()}
          label="¶"
          active={editor.isActive('paragraph')}
        />
        <div className="qe-toolbar__sep" />
        <TB
          cmd={() => editor.chain().focus().toggleBulletList().run()}
          label="•"
          active={editor.isActive('bulletList')}
        />
        <TB
          cmd={() => editor.chain().focus().toggleOrderedList().run()}
          label="1."
          active={editor.isActive('orderedList')}
        />
        <TB
          cmd={() => editor.chain().focus().toggleBlockquote().run()}
          label="❝"
          active={editor.isActive('blockquote')}
        />
        <div className="qe-toolbar__sep" />
        <TB
          cmd={() => editor.chain().focus().setHorizontalRule().run()}
          label="—"
        />
        <TB cmd={() => setShowImagePicker(true)} label="🖼" />
        <div className="qe-toolbar__sep" />
        {/* 色板選擇器 */}
        <div ref={paletteRef} style={{ position: 'relative' }}>
          <button
            className={`qe-toolbar__btn${currentColor ? ' qe-toolbar__btn--active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              savedSelection.current = {
                from: editor.state.selection.from,
                to: editor.state.selection.to,
              };
              setShowColorPalette((v) => !v);
            }}
            title="文字顏色"
            style={{ color: currentColor || 'inherit' }}
          >
            A
          </button>
          {showColorPalette && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                zIndex: 50,
                background: 'var(--qe-paper)',
                border: '1px solid var(--qe-line)',
                padding: 6,
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                gap: 4,
                boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              {COLOR_SWATCHES.map((s) => (
                <button
                  key={s.color}
                  title={s.label}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // 恢復選取再套色
                    const sel = savedSelection.current;
                    if (sel) {
                      editor
                        .chain()
                        .focus()
                        .setTextSelection(sel)
                        .setColor(s.color)
                        .run();
                    } else {
                      editor.chain().focus().setColor(s.color).run();
                    }
                    setShowColorPalette(false);
                  }}
                  style={{
                    width: 22,
                    height: 22,
                    background: s.color,
                    border:
                      currentColor === s.color
                        ? '2px solid var(--qe-ink)'
                        : '1px solid var(--qe-line)',
                    borderRadius: 2,
                    cursor: 'pointer',
                  }}
                />
              ))}
              {/* 自訂顏色 */}
              <label
                title="自訂顏色"
                style={{
                  width: 22,
                  height: 22,
                  background:
                    'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
                  border: '1px solid var(--qe-line)',
                  borderRadius: 2,
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden',
                }}
                onMouseDown={() => {
                  savedSelection.current = {
                    from: editor.state.selection.from,
                    to: editor.state.selection.to,
                  };
                }}
              >
                <input
                  type="color"
                  style={{
                    position: 'absolute',
                    opacity: 0,
                    width: '100%',
                    height: '100%',
                    cursor: 'pointer',
                  }}
                  onChange={(e) => {
                    // 即時套色但不關閉色板——讓使用者可以自由拖曳調色
                    const sel = savedSelection.current;
                    if (sel) {
                      editor
                        .chain()
                        .focus()
                        .setTextSelection(sel)
                        .setColor(e.target.value)
                        .run();
                    } else {
                      editor.chain().focus().setColor(e.target.value).run();
                    }
                  }}
                />
              </label>
              {/* 清除色彩 */}
              <button
                title="清除色彩"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const sel = savedSelection.current;
                  if (sel) {
                    editor
                      .chain()
                      .focus()
                      .setTextSelection(sel)
                      .unsetColor()
                      .run();
                  } else {
                    editor.chain().focus().unsetColor().run();
                  }
                  setShowColorPalette(false);
                }}
                style={{
                  width: 22,
                  height: 22,
                  background: 'var(--qe-paper)',
                  border: '1px solid var(--qe-line)',
                  borderRadius: 2,
                  cursor: 'pointer',
                  fontSize: 10,
                  lineHeight: '20px',
                }}
              >
                ✕
              </button>
            </div>
          )}
        </div>
        <TB
          cmd={() =>
            editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run()
          }
          label="Hi"
          active={editor.isActive('highlight')}
          title="螢光標記"
        />
      </div>
      <EditorContent editor={editor} />
      {showImagePicker && (
        <ImagePickerDialog
          apiBase={apiBase}
          token={token}
          onInsert={(key) => {
            const src =
              key.startsWith('http') || key.startsWith('/')
                ? key
                : `/api/root/assets/${key.split('/').map(encodeURIComponent).join('/')}`;
            editor!.chain().focus().setImage({ src }).run();
          }}
          onClose={() => setShowImagePicker(false)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  PROJECTS EDITOR
// ═══════════════════════════════════════════════════════════════════
function ProjectsEditor({
  items,
  setItems,
  api,
  apiBase,
  token,
}: {
  items: RootProject[];
  setItems: React.Dispatch<React.SetStateAction<RootProject[]>>;
  apiBase: string;
  token: string;
  api: (p: string, m: string, b?: any) => Promise<any>;
}) {
  const [idx, setIdx] = useState(0);
  const [filter, setFilter] = useState('all');
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const [dirty, setDirty] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const [dialog, setDialog] = useState<ConfirmDialogState>(DIALOG_CLOSED);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // ── 排序 + 拖曳 ──
  const sorted = useMemo(
    () => [...items].sort((a, b) => a.sortOrder - b.sortOrder),
    [items]
  );
  const list =
    filter === 'all' ? sorted : sorted.filter((p) => p.tags.includes(filter));
  const p = list[idx] || list[0];
  const canDrag = filter === 'all';
  const [dragSrcIdx, setDragSrcIdx] = useState(-1);
  const [dragOverIdx, setDragOverIdx] = useState(-1);
  const [dragOverHalf, setDragOverHalf] = useState<'top' | 'bottom'>('bottom');

  const handleReorder = useCallback(
    async (fromIdx: number, toIdx: number) => {
      if (fromIdx === toIdx) return;
      const next = [...sorted];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      // 重新分配 sortOrder
      const updated = next.map((item, i) => ({ ...item, sortOrder: i }));
      // 追蹤目前選中的項目
      const selectedId = p?.id;
      setItems(updated);
      if (selectedId) {
        const newIdx = updated.findIndex((x) => x.id === selectedId);
        if (newIdx >= 0) setIdx(newIdx);
      }
      // 批次存檔（只更新 sortOrder 有變化的項目）
      for (const item of updated) {
        const orig = sorted.find((s) => s.id === item.id);
        if (orig && orig.sortOrder !== item.sortOrder) {
          await api(`/api/root/projects/${item.id}`, 'PUT', {
            sortOrder: item.sortOrder,
          });
        }
      }
    },
    [sorted, p?.id, api, setItems]
  );
  const allTags = useMemo(
    () => [...new Set(items.flatMap((x) => x.tags))],
    [items]
  );

  useEffect(() => {
    setDirty(false);
  }, [p?.id]);

  const up = useCallback(
    (patch: Partial<RootProject>) => {
      if (!p) return;
      setItems((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, ...patch } : x))
      );
      setDirty(true);
    },
    [p?.id, setItems]
  );

  const save = useCallback(async () => {
    if (!p) return;
    const { id, createdAt, updatedAt, deletedAt, ...body } = p;
    const res = await api(`/api/root/projects/${id}`, 'PUT', body);
    if (res.ok) setDirty(false);
  }, [p, api]);

  const remove = useCallback(() => {
    if (!p) return;
    setDialog({
      open: true,
      title: `確認刪除「${p.titleZh || p.id}」？`,
      description: '此操作無法復原。',
      confirmLabel: '刪除',
      danger: true,
      onConfirm: async () => {
        const res = await api(`/api/root/projects/${p.id}`, 'DELETE');
        if (res.ok) {
          setItems((prev) => prev.filter((x) => x.id !== p.id));
          setIdx(0);
        }
      },
    });
  }, [p, api, setItems]);

  const create = useCallback(
    async (newId: string) => {
      const body = {
        titleZh: '新作品',
        titleEn: 'New Project',
        descZh: '',
        descEn: '',
        contentZh: '',
        contentEn: '',
        tags: [],
        featured: false,
        sortOrder: 0,
        status: 'active',
      };
      const res = await api(`/api/root/projects/${newId}`, 'PUT', body);
      if (res.ok && res.data) {
        setItems((prev) => [res.data, ...prev]);
        setIdx(0);
        setShowNew(false);
      }
    },
    [api, setItems]
  );

  if (!p)
    return (
      <div className="qe-empty">
        <Mono>no projects</Mono>
      </div>
    );

  const title = lang === 'zh' ? p.titleZh : p.titleEn;
  const desc = lang === 'zh' ? p.descZh : p.descEn;
  const content = lang === 'zh' ? p.contentZh : p.contentEn;

  return (
    <>
      {/* LEFT */}
      <aside className="qe-left">
        <div className="qe-left__header">
          <div>
            <Mono v="navy">—— projects</Mono>
            <div style={{ marginTop: 4 }}>
              <Mono>
                {list.length} of {items.length}
              </Mono>
            </div>
          </div>
          <button
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--qe-navy)',
              fontSize: 18,
              cursor: 'pointer',
            }}
            onClick={() => setShowNew(true)}
          >
            ＋
          </button>
        </div>
        {allTags.length > 0 && (
          <div className="qe-filters">
            <button
              className={`qe-filter${filter === 'all' ? ' qe-filter--active' : ''}`}
              onClick={() => {
                setFilter('all');
                setIdx(0);
              }}
            >
              all
            </button>
            {allTags.map((t) => (
              <button
                key={t}
                className={`qe-filter${filter === t ? ' qe-filter--active' : ''}`}
                onClick={() => {
                  setFilter(t);
                  setIdx(0);
                }}
              >
                {t}
              </button>
            ))}
          </div>
        )}
        <div
          className={`qe-left__body${dragSrcIdx >= 0 ? ' qe-left__body--dragging' : ''}`}
        >
          {list.map((x, i) => (
            <OutlineRow
              key={x.id}
              active={i === idx}
              num={String(i + 1).padStart(2, '0')}
              label={`${x.titleZh || x.id}${x.featured ? ' ★' : ''}`}
              sub={`${x.status} · ${x.tags.join(', ') || '—'}`}
              onClick={() => setIdx(i)}
              draggable={canDrag}
              dragClass={
                dragSrcIdx === i
                  ? 'qe-row--dragging'
                  : dragOverIdx === i && dragSrcIdx !== i
                    ? `qe-row--drop-${dragOverHalf}`
                    : undefined
              }
              onDragStart={(e) => {
                setDragSrcIdx(i);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const rect = e.currentTarget.getBoundingClientRect();
                const mid = rect.top + rect.height / 2;
                setDragOverHalf(e.clientY < mid ? 'top' : 'bottom');
                setDragOverIdx(i);
              }}
              onDragLeave={() => setDragOverIdx(-1)}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragSrcIdx;
                if (from >= 0 && from !== i) {
                  const to =
                    dragOverHalf === 'top'
                      ? from < i
                        ? i - 1
                        : i
                      : from < i
                        ? i
                        : i + 1;
                  handleReorder(
                    from,
                    Math.max(0, Math.min(to, list.length - 1))
                  );
                }
                setDragOverIdx(-1);
                setDragSrcIdx(-1);
              }}
              onDragEnd={() => {
                setDragOverIdx(-1);
                setDragSrcIdx(-1);
              }}
            />
          ))}
        </div>
        <div className="qe-left__add" onClick={() => setShowNew(true)}>
          ＋ new project
        </div>
      </aside>

      {/* CENTER — main editing area */}
      <main className="qe-center">
        <div className="qe-editor-surface">
          <div className="qe-lang-toggle">
            <button
              className={`qe-lang-toggle__btn${lang === 'zh' ? ' qe-lang-toggle__btn--active' : ''}`}
              onClick={() => setLang('zh')}
            >
              繁中
            </button>
            <button
              className={`qe-lang-toggle__btn${lang === 'en' ? ' qe-lang-toggle__btn--active' : ''}`}
              onClick={() => setLang('en')}
            >
              EN
            </button>
          </div>

          <div className="qe-section-label">
            —— {p.id} · {p.status}
          </div>
          <input
            className="qe-title-input"
            value={title}
            placeholder="作品標題"
            onChange={(e) =>
              up(
                lang === 'zh'
                  ? { titleZh: e.target.value }
                  : { titleEn: e.target.value }
              )
            }
          />
          <input
            className="qe-subtitle-input"
            value={lang === 'zh' ? p.titleEn : p.titleZh}
            placeholder={lang === 'zh' ? 'English title' : '中文標題'}
            readOnly
            style={{ opacity: 0.5 }}
          />

          <div className="qe-section-label" style={{ marginTop: 24 }}>
            —— description
          </div>
          <textarea
            className="qe-desc-textarea"
            value={desc}
            rows={3}
            placeholder={
              lang === 'zh' ? '一句話描述這個作品' : 'One-line description'
            }
            onChange={(e) =>
              up(
                lang === 'zh'
                  ? { descZh: e.target.value }
                  : { descEn: e.target.value }
              )
            }
          />

          <div className="qe-section-label">
            —— content · {lang === 'zh' ? '繁中' : 'english'}
          </div>
          <TipTapEditor
            key={`${p.id}-${lang}`}
            content={content}
            onUpdate={(html) =>
              up(lang === 'zh' ? { contentZh: html } : { contentEn: html })
            }
            placeholder={
              lang === 'zh' ? '撰寫作品介紹…' : 'Write about this project…'
            }
            apiBase={apiBase}
            token={token}
          />
        </div>
      </main>

      {/* RIGHT — inspector (metadata only) */}
      <aside className="qe-right">
        <div className="qe-right__header">
          <Mono v="navy">—— inspector · metadata</Mono>
        </div>
        <div className="qe-right__body">
          <Divider label="identity" />
          <Field label="id">
            <Input value={p.id} onChange={() => {}} mono disabled />
          </Field>

          <Divider label="status" />
          <Field label="status">
            <Select
              value={p.status}
              onChange={(v) => up({ status: v })}
              options={[
                ['active', 'active'],
                ['paused', 'paused'],
                ['completed', 'completed'],
                ['archived', 'archived'],
              ]}
            />
          </Field>
          <Toggle
            label="featured (首頁精選)"
            checked={p.featured}
            onChange={(v) => up({ featured: v })}
          />
          <Field label="order">
            <Mono v="fade">
              #{idx + 1} / {list.length} — 拖曳左側列表排序
            </Mono>
          </Field>

          <Divider label="dates" />
          <Field label="start">
            <Input
              value={p.startDate || ''}
              onChange={(v) => up({ startDate: v || null })}
              mono
              placeholder="YYYY-MM-DD"
            />
          </Field>
          <Field label="end">
            <Input
              value={p.endDate || ''}
              onChange={(v) => up({ endDate: v || null })}
              mono
              placeholder="YYYY-MM-DD"
            />
          </Field>

          <Divider label="tags" />
          <TagEditor tags={p.tags} onChange={(t) => up({ tags: t })} />

          <Divider label="links" />
          <Field label="demo">
            <Input
              value={p.links?.demo || ''}
              onChange={(v) => up({ links: { ...p.links, demo: v || null } })}
              mono
              placeholder="https://..."
            />
          </Field>
          <Field label="github">
            <Input
              value={p.links?.github || ''}
              onChange={(v) => up({ links: { ...p.links, github: v || null } })}
              mono
              placeholder="https://..."
            />
          </Field>
          <Field label="website">
            <Input
              value={p.links?.website || ''}
              onChange={(v) =>
                up({ links: { ...p.links, website: v || null } })
              }
              mono
              placeholder="https://..."
            />
          </Field>

          <Divider label="image" />
          <Field label="cover">
            {p.image && (
              <img
                src={`${apiBase}/api/root/assets/${p.image.split('/').map(encodeURIComponent).join('/')}`}
                alt="cover"
                style={{
                  width: '100%',
                  height: 80,
                  objectFit: 'cover',
                  border: '1px solid var(--qe-line)',
                  marginBottom: 6,
                }}
              />
            )}
            <Input
              value={p.image || ''}
              onChange={(v) => up({ image: v || null })}
              mono
              placeholder="/images/..."
            />
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              <button
                className="qe-topbar__btn"
                style={{ flex: 1, padding: '5px 8px' }}
                onClick={() => setShowCoverPicker(true)}
              >
                <Mono style={{ color: 'inherit' }}>媒體庫</Mono>
              </button>
              <button
                className="qe-topbar__btn"
                style={{ flex: 1, padding: '5px 8px' }}
                onClick={() => coverInputRef.current?.click()}
              >
                <Mono style={{ color: 'inherit' }}>上傳</Mono>
              </button>
              {p.image && (
                <button
                  className="qe-topbar__btn"
                  style={{ padding: '5px 8px' }}
                  onClick={() => up({ image: null })}
                >
                  <Mono style={{ color: 'inherit' }}>✕</Mono>
                </button>
              )}
            </div>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const formData = new FormData();
                formData.append('file', file);
                try {
                  const headers: Record<string, string> = {};
                  if (token) headers['Authorization'] = `Bearer ${token}`;
                  const res = await fetch(`${apiBase}/api/root/assets`, {
                    method: 'POST',
                    headers,
                    body: formData,
                  });
                  const json = (await res.json()) as {
                    ok: boolean;
                    data?: { key: string };
                  };
                  if (json.ok && json.data?.key) {
                    up({ image: json.data.key });
                  }
                } catch {
                  /* silent */
                }
                if (coverInputRef.current) coverInputRef.current.value = '';
              }}
            />
          </Field>
          {showCoverPicker && (
            <ImagePickerDialog
              apiBase={apiBase}
              token={token}
              onInsert={(key) => {
                up({ image: key });
              }}
              onClose={() => setShowCoverPicker(false)}
            />
          )}

          <Divider label="actions" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="qe-topbar__btn qe-topbar__btn--primary"
              style={{ flex: 1 }}
              onClick={save}
              disabled={!dirty}
            >
              <Mono style={{ color: 'inherit' }}>
                {dirty ? '● save' : 'synced'}
              </Mono>
            </button>
            <button
              className="qe-topbar__btn qe-topbar__btn--danger"
              onClick={remove}
            >
              <Mono style={{ color: 'inherit' }}>delete</Mono>
            </button>
          </div>
        </div>
      </aside>
      {showNew && (
        <NewItemModal
          title="新增作品"
          onClose={() => setShowNew(false)}
          onConfirm={create}
        />
      )}
      <ConfirmDialog state={dialog} onClose={() => setDialog(DIALOG_CLOSED)} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  UPDATES EDITOR
// ═══════════════════════════════════════════════════════════════════
function UpdatesEditor({
  items,
  setItems,
  api,
  apiBase,
  token,
}: {
  items: RootUpdate[];
  setItems: React.Dispatch<React.SetStateAction<RootUpdate[]>>;
  apiBase: string;
  token: string;
  api: (p: string, m: string, b?: any) => Promise<any>;
}) {
  const [idx, setIdx] = useState(0);
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const [dirty, setDirty] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [dialog, setDialog] = useState<ConfirmDialogState>(DIALOG_CLOSED);

  const u = items[idx] || items[0];
  useEffect(() => {
    setDirty(false);
  }, [u?.id]);

  const up = useCallback(
    (patch: Partial<RootUpdate>) => {
      if (!u) return;
      setItems((prev) =>
        prev.map((x) => (x.id === u.id ? { ...x, ...patch } : x))
      );
      setDirty(true);
    },
    [u?.id, setItems]
  );

  const save = useCallback(async () => {
    if (!u) return;
    const { id, createdAt, updatedAt, deletedAt, ...body } = u;
    const res = await api(`/api/root/updates/${id}`, 'PUT', body);
    if (res.ok) setDirty(false);
  }, [u, api]);

  const remove = useCallback(() => {
    if (!u) return;
    setDialog({
      open: true,
      title: `確認刪除「${u.titleZh || u.id}」？`,
      description: '此操作無法復原。',
      confirmLabel: '刪除',
      danger: true,
      onConfirm: async () => {
        const res = await api(`/api/root/updates/${u.id}`, 'DELETE');
        if (res.ok) {
          setItems((prev) => prev.filter((x) => x.id !== u.id));
          setIdx(0);
        }
      },
    });
  }, [u, api, setItems]);

  const create = useCallback(
    async (newId: string) => {
      const body = {
        titleZh: '新動態',
        titleEn: 'New Update',
        descZh: '',
        descEn: '',
        contentZh: '',
        contentEn: '',
        date: new Date().toISOString().slice(0, 10),
        category: 'other',
        featured: false,
      };
      const res = await api(`/api/root/updates/${newId}`, 'PUT', body);
      if (res.ok && res.data) {
        setItems((prev) => [res.data, ...prev]);
        setIdx(0);
        setShowNew(false);
      }
    },
    [api, setItems]
  );

  if (!u)
    return (
      <div className="qe-empty">
        <Mono>no updates</Mono>
      </div>
    );

  const title = lang === 'zh' ? u.titleZh : u.titleEn;
  const desc = lang === 'zh' ? u.descZh : u.descEn;
  const content = lang === 'zh' ? u.contentZh : u.contentEn;

  return (
    <>
      <aside className="qe-left">
        <div className="qe-left__header">
          <div>
            <Mono v="navy">—— updates · log</Mono>
            <div style={{ marginTop: 4 }}>
              <Mono>{items.length} entries</Mono>
            </div>
          </div>
          <button
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--qe-navy)',
              fontSize: 18,
              cursor: 'pointer',
            }}
            onClick={() => setShowNew(true)}
          >
            ＋
          </button>
        </div>
        <div className="qe-left__body">
          {items.map((x, i) => (
            <OutlineRow
              key={x.id}
              active={i === idx}
              num={x.date?.slice(2, 7) || '—'}
              label={x.titleZh || x.id}
              sub={`${x.category} · ${x.date || '—'}`}
              onClick={() => setIdx(i)}
            />
          ))}
        </div>
        <div className="qe-left__add" onClick={() => setShowNew(true)}>
          ＋ new update
        </div>
      </aside>

      <main className="qe-center">
        <div className="qe-editor-surface" style={{ maxWidth: 760 }}>
          <div className="qe-lang-toggle">
            <button
              className={`qe-lang-toggle__btn${lang === 'zh' ? ' qe-lang-toggle__btn--active' : ''}`}
              onClick={() => setLang('zh')}
            >
              繁中
            </button>
            <button
              className={`qe-lang-toggle__btn${lang === 'en' ? ' qe-lang-toggle__btn--active' : ''}`}
              onClick={() => setLang('en')}
            >
              EN
            </button>
          </div>

          <div className="qe-section-label">
            —— {u.date} · {u.category}
          </div>
          <input
            className="qe-title-input"
            value={title}
            placeholder="標題"
            onChange={(e) =>
              up(
                lang === 'zh'
                  ? { titleZh: e.target.value }
                  : { titleEn: e.target.value }
              )
            }
          />

          <div className="qe-section-label" style={{ marginTop: 20 }}>
            —— excerpt
          </div>
          <textarea
            className="qe-desc-textarea"
            value={desc}
            rows={3}
            placeholder={lang === 'zh' ? '摘要（顯示在列表頁）' : 'Excerpt'}
            onChange={(e) =>
              up(
                lang === 'zh'
                  ? { descZh: e.target.value }
                  : { descEn: e.target.value }
              )
            }
          />

          <div className="qe-section-label">
            —— body · {lang === 'zh' ? '繁中' : 'english'}
          </div>
          <TipTapEditor
            key={`${u.id}-${lang}`}
            content={content}
            onUpdate={(html) =>
              up(lang === 'zh' ? { contentZh: html } : { contentEn: html })
            }
            placeholder={
              lang === 'zh' ? '撰寫動態內容…' : 'Write update content…'
            }
            apiBase={apiBase}
            token={token}
          />
        </div>
      </main>

      <aside className="qe-right">
        <div className="qe-right__header">
          <Mono v="navy">—— inspector · metadata</Mono>
        </div>
        <div className="qe-right__body">
          <Divider label="identity" />
          <Field label="id">
            <Input value={u.id} onChange={() => {}} mono disabled />
          </Field>
          <Field label="date">
            <Input
              value={u.date || ''}
              onChange={(v) => up({ date: v })}
              mono
              placeholder="YYYY-MM-DD"
            />
          </Field>

          <Divider label="taxonomy" />
          <Field label="category">
            <Select
              value={u.category}
              onChange={(v) => up({ category: v })}
              options={[
                ['website', 'website'],
                ['project', 'project'],
                ['announcement', 'announcement'],
                ['other', 'other'],
              ]}
            />
          </Field>
          <Toggle
            label="featured"
            checked={u.featured}
            onChange={(v) => up({ featured: v })}
          />

          <Divider label="actions" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="qe-topbar__btn qe-topbar__btn--primary"
              style={{ flex: 1 }}
              onClick={save}
              disabled={!dirty}
            >
              <Mono style={{ color: 'inherit' }}>
                {dirty ? '● save' : 'synced'}
              </Mono>
            </button>
            <button
              className="qe-topbar__btn qe-topbar__btn--danger"
              onClick={remove}
            >
              <Mono style={{ color: 'inherit' }}>delete</Mono>
            </button>
          </div>
        </div>
      </aside>
      {showNew && (
        <NewItemModal
          title="新增動態"
          onClose={() => setShowNew(false)}
          onConfirm={create}
        />
      )}
      <ConfirmDialog state={dialog} onClose={() => setDialog(DIALOG_CLOSED)} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  LINKS EDITOR
// ═══════════════════════════════════════════════════════════════════
function LinksEditor({
  items,
  setItems,
  api,
}: {
  items: RootLink[];
  setItems: React.Dispatch<React.SetStateAction<RootLink[]>>;
  api: (p: string, m: string, b?: any) => Promise<any>;
}) {
  const [idx, setIdx] = useState(0);
  const [catFilter, setCatFilter] = useState('all');
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const [dirty, setDirty] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [dialog, setDialog] = useState<ConfirmDialogState>(DIALOG_CLOSED);

  // ── 排序 + 拖曳 ──
  const sorted = useMemo(
    () => [...items].sort((a, b) => a.sortOrder - b.sortOrder),
    [items]
  );
  const list =
    catFilter === 'all'
      ? sorted
      : sorted.filter((l) => l.category === catFilter);
  const lk = list[idx] || list[0];
  const canDrag = catFilter === 'all';
  const [dragSrcIdx, setDragSrcIdx] = useState(-1);
  const [dragOverIdx, setDragOverIdx] = useState(-1);
  const [dragOverHalf, setDragOverHalf] = useState<'top' | 'bottom'>('bottom');

  const handleReorder = useCallback(
    async (fromIdx: number, toIdx: number) => {
      if (fromIdx === toIdx) return;
      const next = [...sorted];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      const updated = next.map((item, i) => ({ ...item, sortOrder: i }));
      const selectedId = lk?.id;
      setItems(updated);
      if (selectedId) {
        const newIdx = updated.findIndex((x) => x.id === selectedId);
        if (newIdx >= 0) setIdx(newIdx);
      }
      for (const item of updated) {
        const orig = sorted.find((s) => s.id === item.id);
        if (orig && orig.sortOrder !== item.sortOrder) {
          await api(`/api/root/links/${item.id}`, 'PUT', {
            sortOrder: item.sortOrder,
          });
        }
      }
    },
    [sorted, lk?.id, api, setItems]
  );

  useEffect(() => {
    setDirty(false);
  }, [lk?.id]);

  const up = useCallback(
    (patch: Partial<RootLink>) => {
      if (!lk) return;
      setItems((prev) =>
        prev.map((x) => (x.id === lk.id ? { ...x, ...patch } : x))
      );
      setDirty(true);
    },
    [lk?.id, setItems]
  );

  const save = useCallback(async () => {
    if (!lk) return;
    const { id, createdAt, updatedAt, deletedAt, ...body } = lk;
    const res = await api(`/api/root/links/${id}`, 'PUT', body);
    if (res.ok) setDirty(false);
  }, [lk, api]);

  const remove = useCallback(() => {
    if (!lk) return;
    setDialog({
      open: true,
      title: `確認刪除「${lk.titleZh || lk.id}」？`,
      description: '此操作無法復原。',
      confirmLabel: '刪除',
      danger: true,
      onConfirm: async () => {
        const res = await api(`/api/root/links/${lk.id}`, 'DELETE');
        if (res.ok) {
          setItems((prev) => prev.filter((x) => x.id !== lk.id));
          setIdx(0);
        }
      },
    });
  }, [lk, api, setItems]);

  const create = useCallback(
    async (newId: string) => {
      const body = {
        titleZh: '新連結',
        titleEn: 'New Link',
        descZh: '',
        descEn: '',
        url: '',
        category: 'other',
        status: 'normal',
        featured: false,
        sortOrder: 0,
      };
      const res = await api(`/api/root/links/${newId}`, 'PUT', body);
      if (res.ok && res.data) {
        setItems((prev) => [res.data, ...prev]);
        setIdx(0);
        setShowNew(false);
      }
    },
    [api, setItems]
  );

  if (!lk)
    return (
      <div className="qe-empty">
        <Mono>no links</Mono>
      </div>
    );

  return (
    <>
      <aside className="qe-left">
        <div className="qe-left__header">
          <div>
            <Mono v="navy">—— links</Mono>
            <div style={{ marginTop: 4 }}>
              <Mono>
                {list.length} of {items.length}
              </Mono>
            </div>
          </div>
          <button
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--qe-navy)',
              fontSize: 18,
              cursor: 'pointer',
            }}
            onClick={() => setShowNew(true)}
          >
            ＋
          </button>
        </div>
        <div className="qe-filters">
          {['all', 'social', 'work', 'creative', 'other'].map((c) => (
            <button
              key={c}
              className={`qe-filter${catFilter === c ? ' qe-filter--active' : ''}`}
              onClick={() => {
                setCatFilter(c);
                setIdx(0);
              }}
            >
              {c}
            </button>
          ))}
        </div>
        <div
          className={`qe-left__body${dragSrcIdx >= 0 ? ' qe-left__body--dragging' : ''}`}
        >
          {list.map((x, i) => (
            <OutlineRow
              key={x.id}
              active={i === idx}
              num={String(i + 1).padStart(2, '0')}
              label={`${x.titleZh || x.id}${x.featured ? ' ★' : ''}`}
              sub={x.url || '—'}
              onClick={() => setIdx(i)}
              draggable={canDrag}
              dragClass={
                dragSrcIdx === i
                  ? 'qe-row--dragging'
                  : dragOverIdx === i && dragSrcIdx !== i
                    ? `qe-row--drop-${dragOverHalf}`
                    : undefined
              }
              onDragStart={(e) => {
                setDragSrcIdx(i);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const rect = e.currentTarget.getBoundingClientRect();
                const mid = rect.top + rect.height / 2;
                setDragOverHalf(e.clientY < mid ? 'top' : 'bottom');
                setDragOverIdx(i);
              }}
              onDragLeave={() => setDragOverIdx(-1)}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragSrcIdx;
                if (from >= 0 && from !== i) {
                  const to =
                    dragOverHalf === 'top'
                      ? from < i
                        ? i - 1
                        : i
                      : from < i
                        ? i
                        : i + 1;
                  handleReorder(
                    from,
                    Math.max(0, Math.min(to, list.length - 1))
                  );
                }
                setDragOverIdx(-1);
                setDragSrcIdx(-1);
              }}
              onDragEnd={() => {
                setDragOverIdx(-1);
                setDragSrcIdx(-1);
              }}
            />
          ))}
        </div>
        <div className="qe-left__add" onClick={() => setShowNew(true)}>
          ＋ new link
        </div>
      </aside>

      <main className="qe-center">
        <div className="qe-editor-surface" style={{ maxWidth: 680 }}>
          <div className="qe-lang-toggle">
            <button
              className={`qe-lang-toggle__btn${lang === 'zh' ? ' qe-lang-toggle__btn--active' : ''}`}
              onClick={() => setLang('zh')}
            >
              繁中
            </button>
            <button
              className={`qe-lang-toggle__btn${lang === 'en' ? ' qe-lang-toggle__btn--active' : ''}`}
              onClick={() => setLang('en')}
            >
              EN
            </button>
          </div>

          <div className="qe-section-label">—— {lk.category}</div>
          <input
            className="qe-title-input"
            style={{ fontSize: 28 }}
            value={lang === 'zh' ? lk.titleZh : lk.titleEn}
            placeholder="連結名稱"
            onChange={(e) =>
              up(
                lang === 'zh'
                  ? { titleZh: e.target.value }
                  : { titleEn: e.target.value }
              )
            }
          />

          <div className="qe-section-label" style={{ marginTop: 16 }}>
            —— url
          </div>
          <input
            className="qe-input qe-input--mono"
            style={{ fontSize: 14, padding: '10px 12px', marginBottom: 16 }}
            value={lk.url}
            onChange={(e) => up({ url: e.target.value })}
            placeholder="https://..."
          />

          <div className="qe-section-label">—— description</div>
          <textarea
            className="qe-desc-textarea"
            value={lang === 'zh' ? lk.descZh : lk.descEn}
            rows={3}
            placeholder={lang === 'zh' ? '簡短描述' : 'Brief description'}
            onChange={(e) =>
              up(
                lang === 'zh'
                  ? { descZh: e.target.value }
                  : { descEn: e.target.value }
              )
            }
          />
        </div>
      </main>

      <aside className="qe-right">
        <div className="qe-right__header">
          <Mono v="navy">—— inspector · metadata</Mono>
        </div>
        <div className="qe-right__body">
          <Divider label="identity" />
          <Field label="id">
            <Input value={lk.id} onChange={() => {}} mono disabled />
          </Field>

          <Divider label="taxonomy" />
          <Field label="category">
            <Select
              value={lk.category}
              onChange={(v) => up({ category: v })}
              options={[
                ['social', 'social'],
                ['work', 'work'],
                ['creative', 'creative'],
                ['other', 'other'],
              ]}
            />
          </Field>
          <Field label="status">
            <Select
              value={lk.status}
              onChange={(v) => up({ status: v })}
              options={[
                ['normal', 'normal'],
                ['deprecated', 'deprecated'],
                ['unmaintained', 'unmaintained'],
              ]}
            />
          </Field>
          <Toggle
            label="featured"
            checked={lk.featured}
            onChange={(v) => up({ featured: v })}
          />
          <Field label="order">
            <Mono v="fade">
              #{idx + 1} / {list.length} — 拖曳左側列表排序
            </Mono>
          </Field>

          <Divider label="display" />
          <Field label="icon">
            <Input
              value={lk.icon || ''}
              onChange={(v) => up({ icon: v || null })}
              mono
              placeholder="auto or R2 path"
            />
          </Field>

          <Divider label="actions" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="qe-topbar__btn qe-topbar__btn--primary"
              style={{ flex: 1 }}
              onClick={save}
              disabled={!dirty}
            >
              <Mono style={{ color: 'inherit' }}>
                {dirty ? '● save' : 'synced'}
              </Mono>
            </button>
            <button
              className="qe-topbar__btn qe-topbar__btn--danger"
              onClick={remove}
            >
              <Mono style={{ color: 'inherit' }}>delete</Mono>
            </button>
          </div>
        </div>
      </aside>
      {showNew && (
        <NewItemModal
          title="新增連結"
          onClose={() => setShowNew(false)}
          onConfirm={create}
        />
      )}
      <ConfirmDialog state={dialog} onClose={() => setDialog(DIALOG_CLOSED)} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN EDITOR
// ═══════════════════════════════════════════════════════════════════
/** 從 cookie 讀取 JWT token（client 端，避免 token 序列化到 HTML） */
function getTokenFromCookie(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(?:^|;\s*)root-admin-jwt=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export default function RootEditor(props: EditorProps) {
  const [page, setPage] = useState('projects');
  // 從 cookie 讀 token，不依賴 SSR prop（避免 token 出現在 HTML 中）
  const token = useMemo(
    () => props.token || getTokenFromCookie(),
    [props.token]
  );
  const [projects, setProjects] = useState<RootProject[]>(props.projects);
  const [updates, setUpdates] = useState<RootUpdate[]>(props.updates);
  const [links, setLinks] = useState<RootLink[]>(props.links);
  const [about, setAbout] = useState<AboutContent | null>(props.about);
  const [aboutEn, setAboutEn] = useState<AboutContent | null>(props.aboutEn);
  const [currently, setCurrently] = useState<CurrentlyContent | null>(
    props.currently
  );
  const [contact, setContact] = useState<ContactData | null>(props.contact);
  const [contactEn, setContactEn] = useState<ContactData | null>(
    props.contactEn
  );
  // 頁面文字 state
  const [pageHomeZh, setPageHomeZh] = useState<PageTextContent | null>(
    props.pageHomeZh
  );
  const [pageHomeEn, setPageHomeEn] = useState<PageTextContent | null>(
    props.pageHomeEn
  );
  const [pageProjectsZh, setPageProjectsZh] = useState<PageTextContent | null>(
    props.pageProjectsZh
  );
  const [pageProjectsEn, setPageProjectsEn] = useState<PageTextContent | null>(
    props.pageProjectsEn
  );
  const [pageUpdatesZh, setPageUpdatesZh] = useState<PageTextContent | null>(
    props.pageUpdatesZh
  );
  const [pageUpdatesEn, setPageUpdatesEn] = useState<PageTextContent | null>(
    props.pageUpdatesEn
  );
  const [pageLinksZh, setPageLinksZh] = useState<PageTextContent | null>(
    props.pageLinksZh
  );
  const [pageLinksEn, setPageLinksEn] = useState<PageTextContent | null>(
    props.pageLinksEn
  );
  const [pageAboutZh, setPageAboutZh] = useState<PageTextContent | null>(
    props.pageAboutZh
  );
  const [pageAboutEn, setPageAboutEn] = useState<PageTextContent | null>(
    props.pageAboutEn
  );
  const [pageContactZh, setPageContactZh] = useState<PageTextContent | null>(
    props.pageContactZh
  );
  const [pageContactEn, setPageContactEn] = useState<PageTextContent | null>(
    props.pageContactEn
  );
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const api = useCallback(
    async (path: string, method: string, body?: any) => {
      const res = await apiCall(props.apiBase, path, method, token, body);
      showToast(
        res.ok
          ? `${method} ${path.split('/').pop()} — ok`
          : `error: ${res.error || 'unknown'}`
      );
      return res;
    },
    [props.apiBase, token, showToast]
  );

  // ⌘S
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        (
          document.querySelector(
            '.qe-topbar__btn--primary:not([disabled])'
          ) as HTMLButtonElement
        )?.click();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const currentPage = PAGES.find((p) => p.id === page) || PAGES[0];

  return (
    <div className="qe">
      {/* ─── top bar ─── */}
      <div className="qe-topbar">
        <div className="qe-topbar__brand">
          <span className="qe-topbar__name">顏榕嶙</span>
          <Mono>· admin</Mono>
          <Mono v="fade">/</Mono>
          <Mono v="navy">{currentPage.label}</Mono>
        </div>
        <span className="qe-topbar__sep" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Mono>page</Mono>
          <select
            className="qe-topbar__select"
            value={page}
            onChange={(e) => setPage(e.target.value)}
          >
            {PAGES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.num} · {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="qe-topbar__spacer" />
        <a
          href="/"
          className="qe-topbar__btn"
          style={{ textDecoration: 'none' }}
        >
          <Mono style={{ color: 'inherit' }}>site ↗</Mono>
        </a>
        <a
          href="/admin/logout"
          className="qe-topbar__btn"
          style={{ textDecoration: 'none' }}
        >
          <Mono style={{ color: 'inherit' }}>logout</Mono>
        </a>
      </div>

      {/* ─── body ─── */}
      <div className="qe-body">
        {page === 'pages' && (
          <PageTextEditor
            homeZh={pageHomeZh}
            homeEn={pageHomeEn}
            projectsZh={pageProjectsZh}
            projectsEn={pageProjectsEn}
            updatesZh={pageUpdatesZh}
            updatesEn={pageUpdatesEn}
            linksZh={pageLinksZh}
            linksEn={pageLinksEn}
            setHomeZh={setPageHomeZh}
            setHomeEn={setPageHomeEn}
            setProjectsZh={setPageProjectsZh}
            setProjectsEn={setPageProjectsEn}
            setUpdatesZh={setPageUpdatesZh}
            setUpdatesEn={setPageUpdatesEn}
            setLinksZh={setPageLinksZh}
            setLinksEn={setPageLinksEn}
            aboutZh={pageAboutZh}
            aboutEn={pageAboutEn}
            contactZh={pageContactZh}
            contactEn={pageContactEn}
            setAboutZh={setPageAboutZh}
            setAboutEn={setPageAboutEn}
            setContactZh={setPageContactZh}
            setContactEn={setPageContactEn}
            api={api}
          />
        )}
        {page === 'projects' && (
          <ProjectsEditor
            items={projects}
            setItems={setProjects}
            api={api}
            apiBase={props.apiBase}
            token={token}
          />
        )}
        {page === 'updates' && (
          <UpdatesEditor
            items={updates}
            setItems={setUpdates}
            api={api}
            apiBase={props.apiBase}
            token={token}
          />
        )}
        {page === 'links' && (
          <LinksEditor items={links} setItems={setLinks} api={api} />
        )}
        {page === 'about' && (
          <AboutEditor
            dataZh={about}
            dataEn={aboutEn}
            currently={currently}
            setDataZh={setAbout}
            setDataEn={setAboutEn}
            setCurrently={setCurrently}
            api={api}
            apiBase={props.apiBase}
            token={token}
          />
        )}
        {page === 'contact' && (
          <ContactEditor
            dataZh={contact}
            dataEn={contactEn}
            setDataZh={setContact}
            setDataEn={setContactEn}
            api={api}
          />
        )}
        {page === 'media' && (
          <RootMediaLibrary apiBase={props.apiBase} token={token} mode="page" />
        )}
        {page === 'widgets' && (
          <WidgetEditor
            cards={props.cards}
            api={api}
            apiBase={props.apiBase}
            token={token}
            visitorApiUrl={props.visitorApiUrl || ''}
          />
        )}
      </div>

      {/* ─── status bar ─── */}
      <div className="qe-statusbar">
        <div className="qe-statusbar__group">
          <Mono>D1 · {page}</Mono>
          <Mono>content-api · live</Mono>
        </div>
        <div className="qe-statusbar__group">
          <Mono>
            {page === 'projects'
              ? `${projects.length} entries`
              : page === 'updates'
                ? `${updates.length} entries`
                : page === 'links'
                  ? `${links.length} entries`
                  : page === 'media'
                    ? 'r2 · root-assets'
                    : page === 'widgets'
                      ? `${props.cards.length} cards`
                      : 'singleton'}
          </Mono>
          <Mono v="navy">{APP_VERSION}</Mono>
        </div>
      </div>

      {toast && <div className="qe-toast">{toast}</div>}
    </div>
  );
}
