/* eslint-disable no-undef */
import { useEditor, EditorContent } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { TextStyle, FontSize } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { FontFamily } from '@tiptap/extension-font-family';
import { Highlight } from '@tiptap/extension-highlight';
import { TextAlign } from '@tiptap/extension-text-align';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Image } from '@tiptap/extension-image';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ZONES } from '../../data/zones';
import EditorPageTree from './EditorPageTree';
import EditorInspector from './EditorInspector';
import EchoesEditorBody, {
  parseEchoesData,
  serializeEchoesData,
  type EchoesData,
} from './EchoesEditorBody';
import EchoesSubcatEditor from './EchoesSubcatEditor';
import ZoneTabsEditor, { type ZoneTab } from './ZoneTabsEditor';
import './RichEditor.css';

// === Color palettes ===
const TEXT_COLORS = [
  { label: 'Default', value: '' },
  { label: 'Gold', value: '#d5b618' },
  { label: 'Purple', value: '#a855f7' },
  { label: 'Cyan', value: '#06b6d4' },
  { label: 'Red', value: '#ef4444' },
  { label: 'Pink', value: '#ec4899' },
  { label: 'Green', value: '#22c55e' },
  { label: 'Orange', value: '#f97316' },
  { label: 'White', value: '#f8f8ff' },
  { label: 'Gray', value: '#9ca3af' },
];

const HIGHLIGHT_COLORS = [
  { label: 'None', value: '' },
  { label: 'Yellow', value: '#fde047' },
  { label: 'Red', value: '#fca5a5' },
  { label: 'Green', value: '#86efac' },
  { label: 'Cyan', value: '#67e8f9' },
  { label: 'Purple', value: '#d8b4fe' },
];

const FONT_FAMILIES = [
  { label: 'Default', value: '' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', value: '"Cascadia Code", "Fira Code", Consolas, monospace' },
  { label: 'Script', value: '"Segoe Script", "Comic Sans MS", cursive' },
];

const HEADING_LEVELS = [
  { label: '\u5167\u6587', value: 0 },
  { label: 'H1', value: 1 },
  { label: 'H2', value: 2 },
  { label: 'H3', value: 3 },
];

// === 字型大小預設值 ===
const FONT_SIZES = [
  { label: '小字', value: '13px' },
  { label: '內文', value: '' },
  { label: '大字', value: '20px' },
  { label: '特大', value: '26px' },
];

// === Props ===
interface RichEditorProps {
  initialContent: string;
  initialTitle: string;
  apiBase: string;
  area: string;
  pageSlug: string;
  pageStatus: string;
  zoneId: string;
  initialParentId?: string | null;
  initialPageType?: string;
  initialDepth?: number;
  initialMetadata?: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
}

export default function RichEditor({
  initialContent,
  initialTitle,
  apiBase,
  area,
  pageSlug,
  pageStatus,
  zoneId,
  initialParentId,
  initialPageType,
  initialDepth,
  initialMetadata,
  createdAt,
  updatedAt,
}: RichEditorProps) {
  // Zone accent resolution
  const zone = ZONES.find((z) => z.id === zoneId || z.slug === zoneId);
  const accentMain = zone?.main ?? '#3A3A3A';
  const isEntryMode = !pageSlug;

  // State
  const [isDirty, setIsDirty] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [parentId, setParentId] = useState(initialParentId || '');
  const [pageType, setPageType] = useState(initialPageType || 'section');
  const [depth, setDepth] = useState(initialDepth || 0);
  const [hidden, setHidden] = useState(initialMetadata?.hidden === true);
  const [locked, setLocked] = useState(initialMetadata?.locked === true);
  const [icon, setIcon] = useState(initialMetadata?.icon || '');
  const [description, setDescription] = useState(
    initialMetadata?.description || ''
  );
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 字型大小自訂輸入
  const [customFontSize, setCustomFontSize] = useState('');

  // 連結 popover 狀態
  const [linkHref, setLinkHref] = useState('');
  const [linkOpenInNew, setLinkOpenInNew] = useState(false);
  const [linkMode, setLinkMode] = useState<'url' | 'page'>('url');
  const [linkPageTree, setLinkPageTree] = useState<any[]>([]);
  const [linkPageTreeLoading, setLinkPageTreeLoading] = useState(false);

  // Echoes 特殊編輯模式
  const isEchoesArea = area === 'echoes' || zoneId === 'echoes';
  const isEchoes = isEchoesArea && pageType === 'song';
  const isEchoesSubcat = isEchoesArea && pageType === 'subcategory';
  const isZone = pageType === 'zone';
  const isPageType =
    !isEntryMode && (pageType === 'page' || pageType === 'homepage');
  const [echoesData, setEchoesData] = useState<EchoesData>(() =>
    parseEchoesData(initialMetadata || {})
  );
  const [zoneTabs, setZoneTabs] = useState<ZoneTab[]>(
    () => (initialMetadata?.zoneTabs as ZoneTab[]) || []
  );

  // TipTap editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        horizontalRule: {},
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
        },
      }),
      Underline,
      TextStyle,
      FontSize,
      Color,
      FontFamily,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder: '\u958B\u59CB\u5BEB\u4F5C...' }),
      Image.configure({ inline: false }),
    ],
    content: initialContent || '<p></p>',
    editorProps: {
      attributes: {
        class: 'tiptap-content',
        spellcheck: 'false',
      },
    },
    onUpdate: () => {
      setIsDirty(true);
    },
  });

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Save handler
  const handleSave = useCallback(async () => {
    if (!isDirty) return;
    if (!isEchoes && !editor) return;
    setSaveStatus('saving');
    try {
      const content = isEchoes
        ? [{ id: 'content', type: 'rich_text', content: '' }]
        : [{ id: 'content', type: 'rich_text', content: editor!.getHTML() }];

      const metadata: Record<string, any> = {
        ...(hidden ? { hidden: true } : {}),
        ...(locked ? { locked: true } : {}),
        ...(icon ? { icon } : {}),
        ...(description ? { description } : {}),
        ...(isEchoes ? serializeEchoesData(echoesData) : {}),
        ...(isZone && zoneTabs.length > 0 ? { zoneTabs } : {}),
      };

      const res = await fetch(`${apiBase}/api/content/${area}/${pageSlug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content,
          parentId: parentId || null,
          pageType,
          depth,
          metadata,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Save failed');
      setIsDirty(false);
      setSaveStatus('saved');
      setTreeRefreshKey((k) => k + 1);
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }, [
    editor,
    isDirty,
    isEchoes,
    isZone,
    echoesData,
    zoneTabs,
    title,
    apiBase,
    area,
    pageSlug,
    parentId,
    pageType,
    depth,
    hidden,
    locked,
    icon,
    description,
  ]);

  // Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  // beforeunload
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  if (!editor && !isEchoes) return null;

  // Toolbar helpers
  const toggleDropdown = (name: string) => {
    setActiveDropdown((prev) => (prev === name ? null : name));
  };

  const setColor = (color: string) => {
    if (color) editor.chain().focus().setColor(color).run();
    else editor.chain().focus().unsetColor().run();
    setActiveDropdown(null);
  };

  const setHighlight = (color: string) => {
    if (color) editor.chain().focus().setHighlight({ color }).run();
    else editor.chain().focus().unsetHighlight().run();
    setActiveDropdown(null);
  };

  const setFont = (font: string) => {
    if (font) editor.chain().focus().setFontFamily(font).run();
    else editor.chain().focus().unsetFontFamily().run();
    setActiveDropdown(null);
  };

  const setHeading = (level: number) => {
    if (level === 0) editor.chain().focus().setParagraph().run();
    else
      editor
        .chain()
        .focus()
        .toggleHeading({ level: level as 1 | 2 | 3 })
        .run();
    setActiveDropdown(null);
  };

  // 設定字型大小
  const handleSetFontSize = (size: string) => {
    if (size) editor.chain().focus().setFontSize(size).run();
    else editor.chain().focus().unsetFontSize().run();
    setActiveDropdown(null);
  };

  // 套用連結
  const applyLink = (href: string) => {
    if (!href) return;
    editor
      .chain()
      .focus()
      .setLink({
        href,
        target: linkOpenInNew ? '_blank' : null,
      })
      .run();
    setActiveDropdown(null);
    setLinkHref('');
  };

  // 移除連結
  const removeLink = () => {
    editor.chain().focus().unsetLink().run();
    setActiveDropdown(null);
  };

  // 載入頁面樹（供內部頁面選擇器使用）
  const loadLinkPageTree = async () => {
    if (linkPageTree.length) return;
    setLinkPageTreeLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/content/${area}/tree`);
      const json = await res.json();
      if (json.ok) setLinkPageTree(json.data || []);
    } catch {
      // 靜默失敗
    } finally {
      setLinkPageTreeLoading(false);
    }
  };

  // 開啟連結下拉面板（預填既有連結）
  const handleOpenLinkDropdown = () => {
    const existingHref = editor.getAttributes('link').href || '';
    if (existingHref.startsWith('@page:')) {
      setLinkHref('');
      setLinkMode('page');
    } else {
      setLinkHref(existingHref);
      setLinkMode('url');
    }
    setLinkOpenInNew(editor.getAttributes('link').target === '_blank');
    toggleDropdown('link');
  };

  // 渲染內部頁面選擇器的樹狀結構
  function renderLinkPageTree(nodes: any[], depth = 0): React.ReactNode {
    return nodes.map((node: any) => (
      <React.Fragment key={node.id}>
        {node.pageType !== 'page' && (
          <button
            className="tb-link-page-item"
            style={{ paddingLeft: `${8 + depth * 12}px` }}
            onClick={() => applyLink(`@page:${node.id}`)}
          >
            <span className="tb-link-page-type">
              {(node.pageType || 'P')[0].toUpperCase()}
            </span>
            {node.title}
          </button>
        )}
        {node.children?.length > 0 &&
          renderLinkPageTree(node.children, depth + 1)}
      </React.Fragment>
    ));
  }

  const imageInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const insertImage = () => {
    imageInputRef.current?.click();
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editor) return;
    e.target.value = '';

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${apiBase}/api/assets`, {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (json.ok) {
        const imgUrl = `${apiBase}${json.data.url}`;
        editor.chain().focus().setImage({ src: imgUrl }).run();
        setIsDirty(true);
      } else {
        window.alert(`Upload failed: ${json.error}`);
      }
    } catch (err: any) {
      window.alert(`Upload error: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const charCount = editor ? editor.getText().length : 0;

  const statusLabel = {
    idle: '',
    saving: 'saving...',
    saved: 'saved',
    error: 'error',
  }[saveStatus];

  const saveButtonLabel = {
    idle: '\u5132\u5B58',
    saving: '\u5132\u5B58\u4E2D...',
    saved: '\u5DF2\u5132\u5B58',
    error: '\u5931\u6557',
  }[saveStatus];

  return (
    <div
      className="ned-app"
      style={{ '--ned-accent': accentMain } as React.CSSProperties}
    >
      {/* Header */}
      <header className="ned-header">
        <a href="/admin" className="ned-header-area">
          $ admin / {area}
        </a>
        {isEntryMode ? (
          <>
            <div className="ned-header-spacer" />
            <span className="ned-header-status">選擇頁面以開始編輯</span>
          </>
        ) : (
          <>
            <div className="ned-header-sep" />
            <input
              className="ned-header-title"
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setIsDirty(true);
              }}
              placeholder="Page title..."
            />
            <span className="ned-header-status">
              {statusLabel ||
                `${pageStatus} \u00b7 ${isDirty ? 'modified' : 'saved'}`}
            </span>
            <div className="ned-header-spacer" />
            <div className="ned-header-right">
              <span className="ned-shortcut-hint">Ctrl+S</span>
              <a
                href={
                  isEchoes
                    ? `/${area}?song=${area}/${pageSlug}`
                    : area === 'echoes' || zoneId === 'echoes'
                      ? `/${area}?page=${area}/${pageSlug}`
                      : `/${area}?page=${area}/${pageSlug}`
                }
                className="ned-btn-ghost"
                target="_blank"
                rel="noopener"
              >
                Preview
              </a>
              <button
                className={`ned-btn-save ${isDirty ? 'is-dirty' : ''}`}
                disabled={!isDirty || saveStatus === 'saving'}
                onClick={handleSave}
              >
                {saveButtonLabel}
              </button>
            </div>
          </>
        )}
      </header>

      {/* Toolbar */}
      {/* Toolbar — 入口模式隱藏 */}
      {!isEntryMode && (
        <div className="ned-toolbar" ref={dropdownRef}>
          {!isEchoes && editor && (
            <>
              {/* Heading dropdown */}
              <div className="tb-group">
                <div className="tb-dropdown-wrap">
                  <button
                    className="tb-btn tb-dropdown-trigger"
                    onClick={() => toggleDropdown('heading')}
                  >
                    {editor.isActive('heading', { level: 1 })
                      ? 'H1'
                      : editor.isActive('heading', { level: 2 })
                        ? 'H2'
                        : editor.isActive('heading', { level: 3 })
                          ? 'H3'
                          : '\u5167\u6587'}
                    <span className="tb-caret">&#9662;</span>
                  </button>
                  {activeDropdown === 'heading' && (
                    <div className="tb-dropdown">
                      {HEADING_LEVELS.map((h) => (
                        <button
                          key={h.value}
                          className="tb-dropdown-item"
                          onClick={() => setHeading(h.value)}
                        >
                          {h.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="tb-sep" />

              {/* Basic formatting */}
              <div className="tb-group">
                <button
                  className={`tb-btn ${editor.isActive('bold') ? 'is-active' : ''}`}
                  onClick={() => editor.chain().focus().toggleBold().run()}
                  title="Bold (Ctrl+B)"
                >
                  <strong>B</strong>
                </button>
                <button
                  className={`tb-btn ${editor.isActive('italic') ? 'is-active' : ''}`}
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                  title="Italic (Ctrl+I)"
                >
                  <em>I</em>
                </button>
                <button
                  className={`tb-btn ${editor.isActive('underline') ? 'is-active' : ''}`}
                  onClick={() => editor.chain().focus().toggleUnderline().run()}
                  title="Underline (Ctrl+U)"
                >
                  <span style={{ textDecoration: 'underline' }}>U</span>
                </button>
                <button
                  className={`tb-btn ${editor.isActive('strike') ? 'is-active' : ''}`}
                  onClick={() => editor.chain().focus().toggleStrike().run()}
                  title="Strikethrough"
                >
                  <s>S</s>
                </button>
              </div>

              <div className="tb-sep" />

              {/* Text color */}
              <div className="tb-group">
                <div className="tb-dropdown-wrap">
                  <button
                    className="tb-btn"
                    onClick={() => toggleDropdown('color')}
                    title="Text color"
                  >
                    <span
                      className="tb-color-preview"
                      style={{
                        borderBottomColor:
                          editor.getAttributes('textStyle').color ||
                          'var(--ink)',
                      }}
                    >
                      A
                    </span>
                  </button>
                  {activeDropdown === 'color' && (
                    <div className="tb-dropdown tb-color-grid">
                      {TEXT_COLORS.map((c) => (
                        <button
                          key={c.value || 'default'}
                          className="tb-color-swatch"
                          style={{ background: c.value || 'var(--ink)' }}
                          onClick={() => setColor(c.value)}
                          title={c.label}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Highlight */}
                <div className="tb-dropdown-wrap">
                  <button
                    className="tb-btn"
                    onClick={() => toggleDropdown('highlight')}
                    title="Highlight"
                  >
                    <span
                      className="tb-highlight-preview"
                      style={{
                        background:
                          editor.getAttributes('highlight').color ||
                          'transparent',
                      }}
                    >
                      H
                    </span>
                  </button>
                  {activeDropdown === 'highlight' && (
                    <div className="tb-dropdown tb-color-grid">
                      {HIGHLIGHT_COLORS.map((c) => (
                        <button
                          key={c.value || 'none'}
                          className="tb-color-swatch"
                          style={{ background: c.value || 'var(--hairline)' }}
                          onClick={() => setHighlight(c.value)}
                          title={c.label}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="tb-sep" />

              {/* Font family */}
              <div className="tb-group">
                <div className="tb-dropdown-wrap">
                  <button
                    className="tb-btn tb-dropdown-trigger"
                    onClick={() => toggleDropdown('font')}
                    title="Font"
                  >
                    Font <span className="tb-caret">&#9662;</span>
                  </button>
                  {activeDropdown === 'font' && (
                    <div className="tb-dropdown">
                      {FONT_FAMILIES.map((f) => (
                        <button
                          key={f.value || 'default'}
                          className="tb-dropdown-item"
                          style={{ fontFamily: f.value || 'inherit' }}
                          onClick={() => setFont(f.value)}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="tb-sep" />

              {/* 字型大小 */}
              <div className="tb-group">
                <div className="tb-dropdown-wrap">
                  <button
                    className="tb-btn tb-dropdown-trigger"
                    onClick={() => toggleDropdown('fontSize')}
                    title="字型大小"
                  >
                    {editor
                      .getAttributes('textStyle')
                      .fontSize?.replace('px', '') || '大小'}
                    <span className="tb-caret">&#9662;</span>
                  </button>
                  {activeDropdown === 'fontSize' && (
                    <div className="tb-dropdown tb-fontsize-panel">
                      {FONT_SIZES.map((s) => (
                        <button
                          key={s.value || 'default'}
                          className={`tb-dropdown-item ${
                            (editor.getAttributes('textStyle').fontSize ||
                              '') === s.value
                              ? 'is-active'
                              : ''
                          }`}
                          onClick={() => handleSetFontSize(s.value)}
                        >
                          <span style={{ fontSize: s.value || 'inherit' }}>
                            {s.label}
                          </span>
                          {s.value && (
                            <span className="tb-fontsize-hint">{s.value}</span>
                          )}
                        </button>
                      ))}
                      <div className="tb-fontsize-divider" />
                      <div className="tb-fontsize-custom">
                        <input
                          type="number"
                          min="8"
                          max="120"
                          placeholder="自訂 px"
                          value={customFontSize}
                          onChange={(e) => setCustomFontSize(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && customFontSize) {
                              handleSetFontSize(`${customFontSize}px`);
                              setCustomFontSize('');
                            }
                            if (e.key === 'Escape') setActiveDropdown(null);
                          }}
                          className="tb-fontsize-input"
                        />
                        <button
                          className="tb-btn"
                          disabled={!customFontSize}
                          onClick={() => {
                            if (customFontSize) {
                              handleSetFontSize(`${customFontSize}px`);
                              setCustomFontSize('');
                            }
                          }}
                        >
                          套用
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="tb-sep" />

              {/* Alignment */}
              <div className="tb-group">
                <button
                  className={`tb-btn ${editor.isActive({ textAlign: 'left' }) ? 'is-active' : ''}`}
                  onClick={() =>
                    editor.chain().focus().setTextAlign('left').run()
                  }
                  title="Align left"
                >
                  &#8676;
                </button>
                <button
                  className={`tb-btn ${editor.isActive({ textAlign: 'center' }) ? 'is-active' : ''}`}
                  onClick={() =>
                    editor.chain().focus().setTextAlign('center').run()
                  }
                  title="Align center"
                >
                  &#8596;
                </button>
                <button
                  className={`tb-btn ${editor.isActive({ textAlign: 'right' }) ? 'is-active' : ''}`}
                  onClick={() =>
                    editor.chain().focus().setTextAlign('right').run()
                  }
                  title="Align right"
                >
                  &#8677;
                </button>
              </div>

              <div className="tb-sep" />

              {/* Lists, blockquote */}
              <div className="tb-group">
                <button
                  className={`tb-btn ${editor.isActive('bulletList') ? 'is-active' : ''}`}
                  onClick={() =>
                    editor.chain().focus().toggleBulletList().run()
                  }
                  title="Bullet list"
                >
                  &#8226;
                </button>
                <button
                  className={`tb-btn ${editor.isActive('orderedList') ? 'is-active' : ''}`}
                  onClick={() =>
                    editor.chain().focus().toggleOrderedList().run()
                  }
                  title="Ordered list"
                >
                  1.
                </button>
                <button
                  className={`tb-btn ${editor.isActive('blockquote') ? 'is-active' : ''}`}
                  onClick={() =>
                    editor.chain().focus().toggleBlockquote().run()
                  }
                  title="Blockquote"
                >
                  &ldquo;
                </button>
              </div>

              <div className="tb-sep" />

              {/* Insert */}
              <div className="tb-group">
                <button
                  className="tb-btn"
                  onClick={() =>
                    editor.chain().focus().setHorizontalRule().run()
                  }
                  title="Horizontal rule"
                >
                  &mdash;
                </button>
                <button
                  className="tb-btn"
                  onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                  title="Code block"
                >
                  &lt;/&gt;
                </button>
                <button
                  className="tb-btn"
                  onClick={insertImage}
                  title="Upload image"
                  disabled={uploading}
                >
                  {uploading ? '\u23F3' : '\u25A2'}
                </button>
              </div>

              <div className="tb-sep" />

              {/* 連結 */}
              <div className="tb-group">
                <div className="tb-dropdown-wrap">
                  <button
                    className={`tb-btn ${editor.isActive('link') ? 'is-active' : ''}`}
                    onClick={handleOpenLinkDropdown}
                    title="插入連結"
                  >
                    &#128279;
                  </button>
                  {activeDropdown === 'link' && (
                    <div className="tb-dropdown tb-link-panel">
                      {/* 模式切換 */}
                      <div className="tb-link-tabs">
                        <button
                          className={`tb-link-tab ${linkMode === 'url' ? 'is-active' : ''}`}
                          onClick={() => setLinkMode('url')}
                        >
                          URL
                        </button>
                        <button
                          className={`tb-link-tab ${linkMode === 'page' ? 'is-active' : ''}`}
                          onClick={() => {
                            setLinkMode('page');
                            void loadLinkPageTree();
                          }}
                        >
                          內部頁面
                        </button>
                      </div>

                      {linkMode === 'url' ? (
                        <>
                          <input
                            className="tb-link-input"
                            type="url"
                            placeholder="https://..."
                            value={linkHref}
                            onChange={(e) => setLinkHref(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') applyLink(linkHref);
                              if (e.key === 'Escape') setActiveDropdown(null);
                            }}
                            autoFocus
                          />
                          <label className="tb-link-option">
                            <input
                              type="checkbox"
                              checked={linkOpenInNew}
                              onChange={(e) =>
                                setLinkOpenInNew(e.target.checked)
                              }
                            />
                            開新分頁
                          </label>
                          <div className="tb-link-actions">
                            <button
                              className="tb-link-apply"
                              disabled={!linkHref}
                              onClick={() => applyLink(linkHref)}
                            >
                              套用
                            </button>
                            {editor.isActive('link') && (
                              <button
                                className="tb-link-remove"
                                onClick={removeLink}
                              >
                                移除連結
                              </button>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          {linkPageTreeLoading && (
                            <div className="tb-link-loading">載入頁面中...</div>
                          )}
                          {!linkPageTreeLoading && (
                            <div className="tb-link-page-tree">
                              {renderLinkPageTree(linkPageTree)}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="tb-sep" />

              {/* 清除格式 */}
              <div className="tb-group">
                <button
                  className="tb-btn"
                  onClick={() =>
                    editor
                      .chain()
                      .focus()
                      .unsetAllMarks()
                      .clearNodes()
                      .setParagraph()
                      .run()
                  }
                  title="清除格式"
                >
                  ✕
                </button>
              </div>
            </>
          )}

          <span className="ned-toolbar-right">
            {isEchoes
              ? 'song mode'
              : isEchoesSubcat
                ? 'playlist mode'
                : isZone
                  ? 'zone mode'
                  : isPageType
                    ? 'homepage mode'
                    : 'rich text'}
            {!isEchoes && ` · ${charCount.toLocaleString()} chars`}
          </span>
        </div>
      )}

      {/* Body — 3 columns (or 2 in homepage mode) */}
      <div className={`ned-body ${isPageType ? 'ned-body--no-tree' : ''}`}>
        {/* Left — Page Tree (hidden in homepage mode) */}
        {!isPageType && (
          <aside className="ned-panel--tree">
            <EditorPageTree
              area={area}
              apiBase={apiBase}
              currentSlug={pageSlug}
              accent={accentMain}
              refreshKey={treeRefreshKey}
            />
          </aside>
        )}

        {/* Middle — Editor */}
        <main className={`ned-editor ${locked ? 'ned-editor--locked' : ''}`}>
          {isEntryMode ? (
            <div className="ned-empty-state">
              <div className="ned-empty-icon" style={{ color: accentMain }}>
                &#9998;
              </div>
              <div className="ned-empty-title">選擇一個項目開始編輯</div>
              <div className="ned-empty-desc">
                從左側的頁面樹點選要編輯的章節或段落，
                <br />
                或在項目之間 hover 來新增頁面。
              </div>
            </div>
          ) : (
            <>
              {locked && (
                <div className="ned-lock-banner">
                  <span>
                    &#128274; This page is locked. Unlock from inspector to
                    edit.
                  </span>
                </div>
              )}
              <div className="ned-paper">
                <div className="ned-breadcrumb">
                  {parentId
                    ? `${area} / ${parentId.replace(/\//g, ' / ')}`
                    : area}
                </div>
                {isEchoes ? (
                  <EchoesEditorBody
                    accent={accentMain}
                    initialData={echoesData}
                    onDataChange={setEchoesData}
                    onDirty={() => setIsDirty(true)}
                  />
                ) : (
                  <>
                    <EditorContent editor={editor} />
                    {isEchoesSubcat && (
                      <EchoesSubcatEditor
                        area={area}
                        apiBase={apiBase}
                        pageId={`${area}/${pageSlug}`}
                        pageSlug={pageSlug}
                        accent={accentMain}
                        onDirty={() => setIsDirty(true)}
                        refreshKey={treeRefreshKey}
                      />
                    )}
                    {isZone && (
                      <ZoneTabsEditor
                        area={area}
                        apiBase={apiBase}
                        pageId={`${area}/${pageSlug}`}
                        accent={accentMain}
                        zoneTabs={zoneTabs}
                        onZoneTabsChange={(tabs) => {
                          setZoneTabs(tabs);
                          setIsDirty(true);
                        }}
                        refreshKey={treeRefreshKey}
                      />
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </main>

        {/* Right — Inspector（入口模式隱藏） */}
        {!isEntryMode && (
          <aside className="ned-panel--inspector">
            <EditorInspector
              area={area}
              pageType={pageType}
              onPageTypeChange={setPageType}
              parentId={parentId}
              onParentIdChange={setParentId}
              depth={depth}
              onDepthChange={setDepth}
              hidden={hidden}
              onHiddenChange={setHidden}
              locked={locked}
              onLockedChange={setLocked}
              icon={icon}
              onIconChange={setIcon}
              description={description}
              onDescriptionChange={setDescription}
              onDirty={() => setIsDirty(true)}
              accent={accentMain}
              pageStatus={pageStatus}
              createdAt={createdAt}
              updatedAt={updatedAt}
            />
          </aside>
        )}
      </div>
      {/* Hidden file input for image upload */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleImageUpload}
      />
    </div>
  );
}
