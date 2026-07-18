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
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { Markdown } from '@tiptap/markdown';
import { MarkdownPaste } from './MarkdownPaste';
import UepDialogueNode from './UepDialogueNode';
import InlineAudioNode from './InlineAudioNode';
import ProgressMarkerNode from './ProgressMarkerNode';
import EchoSpotNode, { type EchoSpotAttributes } from './EchoSpotNode';
import EchoSongPicker, { type EchoSongChoice } from './EchoSongPicker';
import { UepEntityMark, UepCueMark } from './UepEmbedMarks';
import EntityInfoChip from './EntityInfoChip';
import GateConditionEditor from './GateConditionEditor';
import { parseFlagsAttr, serializeFlagsAttr } from '../../progress/markers';
import { parseGateCondition } from '../../progress/gating';
import type { GateCondition } from '../../progress/gating';
import { ENTITY_KINDS, isValidRef, collectEmbeds } from '../../embed';
import EntityIndexPicker, { loadEmbeddableEntries } from './EntityIndexPicker';
import { EntitySuggest } from './EntitySuggestExtension';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  getToast,
  getDialog,
  extractAssetKey,
  deleteAsset,
  htmlToMarkdown,
} from './editorHelpers';
import { resolveEditorMode } from './editorModeRegistry';
import { ZONES } from '../../data/zones';
import { canonicalizePagePath } from '../../lib/pagePath';
import EditorPageTree from './EditorPageTree';
import EditorInspector, {
  Section as InspectorSection,
} from './EditorInspector';
import { LAYOUT_OPTIONS } from './VisualsEditorBody';
import EchoesEditorBody, {
  parseEchoesData,
  serializeEchoesData,
  type EchoesData,
} from './EchoesEditorBody';
import EchoesSubcatEditor from './EchoesSubcatEditor';
import VisualsEditorBody, {
  parseVisualsData,
  serializeVisualsData,
  type VisualsData,
} from './VisualsEditorBody';
import VisualsSubcatEditor from './VisualsSubcatEditor';
import ConceptsEditorBody, {
  parseConceptsEditorData,
  serializeConceptsContent,
  type ConceptsEditorData,
} from './ConceptsEditorBody';
import { collectEntityKeyIssues } from './EntityKeyField';
import StorageDialogueEditor from './StorageDialogueEditor';
import ChangelogEditorBody, { type ChangelogMeta } from './ChangelogEditorBody';
import ThoughtStream from './ThoughtStream';
import StorageSubcatEditor, { type SubcatDef } from './StorageSubcatEditor';
import ZoneTabsEditor, { type ZoneTab } from './ZoneTabsEditor';
import './StorageDialogueEditor.css';
import './ChangelogEditorBody.css';
import './ThoughtStream.css';
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
  { label: '內文', value: 0 },
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

function createEchoSpotId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `spot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

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
  /** Concepts type 頁面的原始 content blocks（結構化 JSON），由 astro 頁面傳入 */
  initialContentBlocks?: { id: string; type: string; content: string }[];
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
  initialContentBlocks,
  createdAt,
  updatedAt,
}: RichEditorProps) {
  // Zone accent resolution
  const zone = ZONES.find((z) => z.id === zoneId || z.slug === zoneId);
  const accentMain = zone?.main ?? '#3A3A3A';
  const isEntryMode = !pageSlug;
  const currentPageId = canonicalizePagePath(
    pageSlug ? [area, pageSlug].join('/') : area
  );

  // State — dirty 由多來源聯合判斷
  const initialContentRef = useRef(initialContent || '<p></p>');
  const initialTitleRef = useRef(initialTitle);

  // 語意化 dirty sources
  const [dirtyTitle, setDirtyTitle] = useState(false);
  const [dirtyTiptap, setDirtyTiptap] = useState(false);
  const [dirtyMetadata, setDirtyMetadata] = useState(false);
  const [dirtyStructured, setDirtyStructured] = useState(false);
  const isDirty = dirtyTitle || dirtyTiptap || dirtyMetadata || dirtyStructured;

  function resetDirty() {
    setDirtyTitle(false);
    setDirtyTiptap(false);
    setDirtyMetadata(false);
    setDirtyStructured(false);
  }

  // 相容 shorthand
  const setEditorDirty = setDirtyTiptap;
  const setMetaDirty = setDirtyMetadata;
  const setConceptsDirty = setDirtyStructured;
  const [title, setTitle] = useState(initialTitle);
  const [parentId, setParentId] = useState(initialParentId || '');
  const [pageType, setPageType] = useState(initialPageType || 'section');
  const [depth, setDepth] = useState(initialDepth || 0);
  const [hidden, setHidden] = useState(initialMetadata?.hidden === true);
  const [locked, setLocked] = useState(initialMetadata?.locked === true);
  // 進度頁：本頁的解鎖倚賴同層前一個進度頁完成（鏈條件由 effectiveGate 動態注入）
  const [progressPage, setProgressPage] = useState(
    initialMetadata?.progressPage === true
  );
  // 豁免：不繼承容器進度（切斷點，子樹一併豁免）——番外/特別篇提前開放用
  const [gateExempt, setGateExempt] = useState(
    initialMetadata?.gateExempt === true
  );
  // 父容器繼承偵測：拉一次父頁面 metadata，若 progressPage=true 則本頁
  // 在 GateConditionEditor 顯示為繼承（toggle 收起、僅剩豁免選項）
  const [parentIsProgressContainer, setParentIsProgressContainer] =
    useState(false);
  useEffect(() => {
    if (!parentId) {
      setParentIsProgressContainer(false);
      return;
    }
    const ctrl = new AbortController();
    fetch(`${apiBase}/api/content/${parentId}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const meta = data?.data?.metadata;
        setParentIsProgressContainer(meta?.progressPage === true);
      })
      .catch(() => {
        // 靜默失敗：找不到父頁（例如新建頁面）→ 視為未繼承
      });
    return () => ctrl.abort();
  }, [parentId, apiBase]);
  // 進度條件（Epic 2 內容閘門）——parseGateCondition 兼容平鋪與巢狀，
  // 存檔時一律正規化為巢狀 metadata.gate
  const [gate, setGate] = useState<GateCondition | null>(() =>
    parseGateCondition(initialMetadata || null)
  );
  const [icon, setIcon] = useState(initialMetadata?.icon || '');
  const [description, setDescription] = useState(
    initialMetadata?.description || ''
  );
  const [layout, setLayout] = useState(initialMetadata?.layout || '');
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
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

  // 嵌入標記 popover 狀態（Epic 2 — entity inline mark；
  // cue 工具已撤下，等浮島階段以旗標式/浮鈕重新設計）
  const [entityDraft, setEntityDraft] = useState({ kind: 'term', ref: '' });
  // 條目級 Reference Picker（S7-D-1：頁面樹改 entity-index 條目清單）
  const [embedPickerOpen, setEmbedPickerOpen] = useState(false);
  const [echoSongPickerOpen, setEchoSongPickerOpen] = useState(false);
  const [echoesValidationIssues, setEchoesValidationIssues] = useState<
    string[]
  >([]);

  // 從 registry 解析 mode
  const editorMode = resolveEditorMode({ area, zoneId, pageType, pageSlug });
  const modeId = editorMode.id;

  // 相容用 shorthand（供渲染判斷使用）
  const isEchoes = modeId === 'echoes.song';
  const isEchoesSubcat = modeId === 'echoes.subcategory';
  const isVisuals = modeId === 'visuals.gallery';
  const isVisualsSubcat = modeId === 'visuals.subcategory';
  const isConcepts = modeId === 'concepts.type';
  const conceptsStackStyle =
    (initialMetadata?.stack_style as string) || 'dossier';
  const isStorageDialogue = modeId === 'storage.dialogue';
  const isStorageChangelog = modeId === 'storage.changelog';
  const isStorageExtras = modeId === 'storage.extras';
  const isStorageClearing = modeId === 'storage.clearing';
  const needsSubcatSelector = editorMode.needsSubcatSelector === true;
  const isZone = modeId === 'zone';
  const isVisualsArea = area === 'visuals' || zoneId === 'visuals';
  const isPageType = modeId === 'homepage' && !isEntryMode;
  const [echoesData, setEchoesData] = useState<EchoesData>(() =>
    parseEchoesData(initialMetadata || {})
  );
  const [visualsData, setVisualsData] = useState<VisualsData>(() =>
    parseVisualsData(initialMetadata || {})
  );
  const [conceptsData, setConceptsData] = useState<ConceptsEditorData>(() =>
    parseConceptsEditorData(initialContentBlocks || [], initialMetadata || {})
  );
  const [zoneTabs, setZoneTabs] = useState<ZoneTab[]>(
    () => (initialMetadata?.zoneTabs as ZoneTab[]) || []
  );
  // Storage dialogue 用的 content blocks
  const [storageDialogueBlocks, setStorageDialogueBlocks] = useState<
    { id: string; type: string; content: string }[]
  >(() => initialContentBlocks || []);
  // Storage changelog 用的 content blocks 和 metadata
  const [changelogBlocks, setChangelogBlocks] = useState<
    { id: string; type: string; content: string }[]
  >(() => initialContentBlocks || []);
  const [changelogMeta, setChangelogMeta] = useState<ChangelogMeta>(() => ({
    version: (initialMetadata?.version as string) || '',
    date: (initialMetadata?.date as string) || '',
    author: (initialMetadata?.author as string) || '',
  }));
  // Storage subcategory 狀態
  const [storageSubcats, setStorageSubcats] = useState<SubcatDef[]>(() =>
    Array.isArray(initialMetadata?.subcategories)
      ? (initialMetadata.subcategories as SubcatDef[])
      : []
  );
  const [storageSubcat, setStorageSubcat] = useState<string>(
    (initialMetadata?.subcategory as string) || ''
  );
  const [availableSubcats, setAvailableSubcats] = useState<SubcatDef[]>([]);

  // TipTap editor
  const editor = useEditor({
    // TipTap v3 預設不在 transaction 時重渲染（v2 預設會），
    // 導致只移動選取範圍時工具列的 isActive 狀態凍結（粗體按鈕黏住等）。
    // 開啟後每次 transaction 都重渲染，工具列狀態才會跟著 selection 即時更新。
    shouldRerenderOnTransaction: true,
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
      Placeholder.configure({ placeholder: '開始寫作...' }),
      Image.configure({ inline: false }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      UepDialogueNode,
      InlineAudioNode,
      ProgressMarkerNode,
      EchoSpotNode,
      UepEntityMark,
      UepCueMark,
      // entity 自動偵測（S7-D-3）：打字命中匹配詞 → Tab 套 entity mark。
      // 僅 history——interactive embedding 是 History 文章專屬
      // （艾斯維爾 2026-07-07 定案），其他區域不掛偵測。
      ...(area === 'history'
        ? [
            EntitySuggest.configure({
              fetchEntries: () => loadEmbeddableEntries(apiBase),
            }),
          ]
        : []),
      Markdown,
      MarkdownPaste,
    ],
    content: isConcepts
      ? initialContentBlocks?.find((b) => b.type === 'rich_text')?.content ||
        '<p></p>'
      : !editorMode.needsTipTap
        ? '<p></p>'
        : initialContent || '<p></p>',
    editorProps: {
      attributes: {
        class: 'tiptap-content',
        spellcheck: 'false',
      },
    },
    onCreate: ({ editor: e }) => {
      // 用 TipTap 正規化後的 HTML 作為基準快照
      initialContentRef.current = e.getHTML();
    },
    onUpdate: ({ editor: e }) => {
      setEditorDirty(e.getHTML() !== initialContentRef.current);
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
    if (editorMode.needsTipTap && !editor) return;

    // entityKey 硬驗證（S7-B 驗收回饋）：輸入層只警告不阻擋打字，
    // 存檔是資料進 D1 的最後關卡——非法/重複 key 直接擋下
    if (isConcepts) {
      const entityKeyIssues = collectEntityKeyIssues(conceptsData.data);
      if (entityKeyIssues.length > 0) {
        getToast().error(
          `entityKey 驗證未通過：${entityKeyIssues[0]}` +
            (entityKeyIssues.length > 1
              ? `（共 ${entityKeyIssues.length} 項）`
              : '')
        );
        return;
      }
    }
    if (isEchoes && echoesValidationIssues.length > 0) {
      getToast().error(
        `Echoes 資料驗證未通過：${echoesValidationIssues[0]}` +
          (echoesValidationIssues.length > 1
            ? `（共 ${echoesValidationIssues.length} 項）`
            : '')
      );
      return;
    }

    setSaveStatus('saving');
    try {
      const content =
        isEchoes || isVisuals
          ? [{ id: 'content', type: 'rich_text', content: '' }]
          : isStorageDialogue
            ? storageDialogueBlocks
            : isStorageChangelog
              ? changelogBlocks
              : isConcepts
                ? [
                    {
                      id: 'intro',
                      type: 'rich_text',
                      content: editor!.getHTML(),
                    },
                    ...serializeConceptsContent(conceptsData),
                  ]
                : [
                    {
                      id: 'content',
                      type: 'rich_text',
                      content: editor!.getHTML(),
                    },
                  ];

      const isVisualsDivision = isVisualsArea && pageType === 'division';

      // 嵌入摘要（Epic 2）：掃描 HTML 中的 entity/cue 標記寫入
      // metadata.related/cues——island 只讀摘要，不必解析整篇 HTML。
      // 只在 editor HTML 實際被持久化的模式計算（echoes/visuals/
      // storage 特化模式不存 editor HTML，摘要會失真）。
      const persistsEditorHtml =
        editorMode.needsTipTap &&
        editor &&
        !isEchoes &&
        !isVisuals &&
        !isStorageDialogue &&
        !isStorageChangelog;
      const embedSummary = persistsEditorHtml
        ? collectEmbeds(
            new DOMParser().parseFromString(editor.getHTML(), 'text/html').body
          )
        : null;

      const metadata: Record<string, any> = {
        ...(initialMetadata || {}),
        ...(hidden ? { hidden: true } : { hidden: undefined }),
        ...(locked ? { locked: true } : { locked: undefined }),
        // 進度頁 toggle：true 才寫入，false 一律清除以維持存檔精簡
        ...(progressPage
          ? { progressPage: true }
          : { progressPage: undefined }),
        // 豁免 toggle：同上，true 才寫入
        ...(gateExempt ? { gateExempt: true } : { gateExempt: undefined }),
        // 進度條件一律存巢狀 gate；平鋪形狀的舊鍵一併清除避免雙重來源
        gate: gate ?? undefined,
        requiresFlags: undefined,
        pristineOnly: undefined,
        // 嵌入摘要：有標記才寫入；標記全移除時一併清除
        ...(embedSummary
          ? {
              related:
                embedSummary.related.length > 0
                  ? embedSummary.related
                  : undefined,
              cues:
                embedSummary.cues.length > 0 ? embedSummary.cues : undefined,
            }
          : {}),
        ...(icon ? { icon } : { icon: undefined }),
        ...(description ? { description } : { description: undefined }),
        ...(isEchoes ? serializeEchoesData(echoesData) : {}),
        ...(isVisuals ? serializeVisualsData(visualsData) : {}),
        ...(isConcepts
          ? {
              type_group: initialMetadata?.type_group,
              era: initialMetadata?.era,
              stack_style: conceptsStackStyle,
            }
          : {}),
        ...(isZone && zoneTabs.length > 0 ? { zoneTabs } : {}),
        ...(isVisualsDivision && layout ? { layout } : {}),
        ...(isStorageChangelog
          ? {
              version: changelogMeta.version || undefined,
              date: changelogMeta.date || undefined,
              author: changelogMeta.author || undefined,
            }
          : {}),
        ...(isStorageClearing
          ? {
              subcategories:
                storageSubcats.length > 0 ? storageSubcats : undefined,
            }
          : {}),
        ...(needsSubcatSelector
          ? { subcategory: storageSubcat || undefined }
          : {}),
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
      // 更新快照並重置 dirty
      if (editor) initialContentRef.current = editor.getHTML();
      initialTitleRef.current = title;
      window.dispatchEvent(new Event('concepts-editor-saved'));
      resetDirty();
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
    modeId,
    echoesData,
    visualsData,
    conceptsData,
    echoesValidationIssues,
    conceptsStackStyle,
    storageDialogueBlocks,
    changelogBlocks,
    changelogMeta,
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
    gate,
    icon,
    description,
    layout,
    isVisualsArea,
    storageSubcats,
    needsSubcatSelector,
    storageSubcat,
  ]);

  // 載入 clearing 的 subcategory 定義（stuff 頁面用）
  useEffect(() => {
    if (!needsSubcatSelector) return;
    const clearingSlug = pageSlug.split('/')[0];
    fetch(`${apiBase}/api/content/storage/${clearingSlug}`)
      .then((r) => r.json())
      .then((json: any) => {
        if (json.ok && Array.isArray(json.data?.metadata?.subcategories)) {
          setAvailableSubcats(json.data.metadata.subcategories as SubcatDef[]);
        }
      })
      .catch(() => {});
  }, [needsSubcatSelector, apiBase, pageSlug]);

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

  // dirty state 的同步 ref——beforeunload 讀 ref 而非 state，
  // 讓 SPA 內守衛（handleBeforeNavigate）在使用者確認捨棄變更後
  // 立刻 bypass 原生 beforeunload，避免二次跳原生 alert
  const dirtyRef = useRef(isDirty);
  useEffect(() => {
    dirtyRef.current = isDirty;
  }, [isDirty]);

  // beforeunload — 關瀏覽器 / 換域 / 未經守衛的 hard navigation 才走這裡
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // 樹狀 / 選單導航前的守衛——用 UepDialog 取代瀏覽器原生 alert
  const handleBeforeNavigate = useCallback(async (): Promise<boolean> => {
    if (!dirtyRef.current) return true;
    const ok = await getDialog().confirm(
      '這頁有未儲存的變更，離開將會捨棄。要繼續嗎？',
      {
        title: '未儲存的變更',
        confirmText: '捨棄變更並離開',
        cancelText: '留在此頁',
      }
    );
    if (ok) dirtyRef.current = false; // bypass 後續 beforeunload
    return ok;
  }, []);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{
    src: string;
    pos: number;
  } | null>(null);
  // 圖片選擇器（媒體庫）
  const [imgPickerOpen, setImgPickerOpen] = useState(false);
  const [imgPickerItems, setImgPickerItems] = useState<
    {
      key: string;
      size: number;
      contentType: string;
      originalName: string;
      referenced: boolean;
    }[]
  >([]);
  const [imgPickerLoading, setImgPickerLoading] = useState(false);
  const [imgPickerSearch, setImgPickerSearch] = useState('');
  // 圖片替換模式（替換時不是插入新圖，而是替換選中圖的 src）
  const [imgReplaceMode, setImgReplaceMode] = useState(false);
  // 圖片刪除確認
  const [imgDeleteConfirm, setImgDeleteConfirm] = useState<{
    src: string;
    pos: number;
  } | null>(null);

  // 音訊 node 選取與選擇器
  const [selectedAudio, setSelectedAudio] = useState<{
    src: string;
    label: string;
    pos: number;
  } | null>(null);
  const [audioPickerOpen, setAudioPickerOpen] = useState(false);
  const [audioPickerItems, setAudioPickerItems] = useState<
    {
      key: string;
      size: number;
      contentType: string;
      originalName: string;
      referenced: boolean;
    }[]
  >([]);
  const [audioPickerLoading, setAudioPickerLoading] = useState(false);
  const [audioPickerSearch, setAudioPickerSearch] = useState('');
  const [audioReplaceMode, setAudioReplaceMode] = useState(false);

  // 進度標記 node 選取與編輯草稿（Epic 2 掃描線）
  const [selectedMarker, setSelectedMarker] = useState<{
    pos: number;
    grantsFlags: string;
    label: string;
  } | null>(null);
  const [markerDraft, setMarkerDraft] = useState<{
    grantsFlags: string;
    label: string;
  }>({ grantsFlags: '', label: '' });
  const [selectedEchoSpot, setSelectedEchoSpot] = useState<
    (EchoSpotAttributes & { pos: number }) | null
  >(null);

  useEffect(() => {
    if (!editor) return;

    const syncSelectedImage = () => {
      const selection = editor.state.selection as any;
      let next: { src: string; pos: number } | null = null;

      if (selection.node?.type?.name === 'image') {
        next = {
          src: selection.node.attrs?.src || '',
          pos: selection.from,
        };
      }

      setSelectedImage((current) =>
        current?.src === next?.src && current?.pos === next?.pos
          ? current
          : next
      );
    };

    syncSelectedImage();
    editor.on('selectionUpdate', syncSelectedImage);
    editor.on('transaction', syncSelectedImage);

    return () => {
      editor.off('selectionUpdate', syncSelectedImage);
      editor.off('transaction', syncSelectedImage);
    };
  }, [editor]);

  // Echo Spot node 選取追蹤：可重新挑曲或刪除，不把錯綁變成永久資料。
  useEffect(() => {
    if (!editor) return;
    const syncSelectedEchoSpot = () => {
      const selection = editor.state.selection as any;
      const next =
        selection.node?.type?.name === 'echoSpot'
          ? ({
              pos: selection.from,
              ...selection.node.attrs,
            } as EchoSpotAttributes & {
              pos: number;
            })
          : null;
      setSelectedEchoSpot((current) =>
        current?.pos === next?.pos && current?.songId === next?.songId
          ? current
          : next
      );
    };
    syncSelectedEchoSpot();
    editor.on('selectionUpdate', syncSelectedEchoSpot);
    editor.on('transaction', syncSelectedEchoSpot);
    return () => {
      editor.off('selectionUpdate', syncSelectedEchoSpot);
      editor.off('transaction', syncSelectedEchoSpot);
    };
  }, [editor]);

  const applyEchoSongChoice = (song: EchoSongChoice) => {
    if (!editor) return;
    const attrs: EchoSpotAttributes = {
      spotId: selectedEchoSpot?.spotId || createEchoSpotId(),
      songId: song.id,
      songUrlKey: song.audioFile,
      ...(song.entityKey ? { entityKey: song.entityKey } : {}),
      title: song.title,
      clusterId: song.clusterId,
      songType: song.songType,
      ...(song.duration ? { duration: song.duration } : {}),
      spoilerLevel: song.spoilerLevel,
      ...(song.spoilerRevisions
        ? { spoilerRevisions: song.spoilerRevisions }
        : {}),
    };
    if (selectedEchoSpot) {
      const node = editor.state.doc.nodeAt(selectedEchoSpot.pos);
      if (node?.type.name === 'echoSpot') {
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(selectedEchoSpot.pos, undefined, attrs)
        );
      }
    } else {
      editor.chain().focus().setEchoSpot(attrs).run();
    }
    setEchoSongPickerOpen(false);
  };

  useEffect(() => {
    if (!editor || !selectedImage || imgDeleteConfirm) return;

    const handleImageDeleteKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!editor.isFocused) return;

      const node = editor.state.doc.nodeAt(selectedImage.pos);
      if (node?.type.name !== 'image') return;

      e.preventDefault();
      e.stopPropagation();
      setImgDeleteConfirm(selectedImage);
    };

    document.addEventListener('keydown', handleImageDeleteKey, true);
    return () =>
      document.removeEventListener('keydown', handleImageDeleteKey, true);
  }, [editor, selectedImage, imgDeleteConfirm]);

  // 音訊 node 選取追蹤
  useEffect(() => {
    if (!editor) return;

    const syncSelectedAudio = () => {
      const selection = editor.state.selection as any;
      let next: { src: string; label: string; pos: number } | null = null;

      if (selection.node?.type?.name === 'inlineAudio') {
        next = {
          src: selection.node.attrs?.src || '',
          label: selection.node.attrs?.label || '',
          pos: selection.from,
        };
      }

      setSelectedAudio((current) =>
        current?.src === next?.src && current?.pos === next?.pos
          ? current
          : next
      );
    };

    syncSelectedAudio();
    editor.on('selectionUpdate', syncSelectedAudio);
    editor.on('transaction', syncSelectedAudio);

    return () => {
      editor.off('selectionUpdate', syncSelectedAudio);
      editor.off('transaction', syncSelectedAudio);
    };
  }, [editor]);

  // 進度標記 node 選取追蹤
  useEffect(() => {
    if (!editor) return;

    const syncSelectedMarker = () => {
      const selection = editor.state.selection as any;
      let next: { pos: number; grantsFlags: string; label: string } | null =
        null;

      if (selection.node?.type?.name === 'progressMarker') {
        const attrs = selection.node.attrs || {};
        next = {
          pos: selection.from,
          grantsFlags: serializeFlagsAttr(
            Array.isArray(attrs.grantsFlags) ? attrs.grantsFlags : []
          ),
          label: attrs.label || '',
        };
      }

      setSelectedMarker((current) =>
        current?.pos === next?.pos &&
        current?.grantsFlags === next?.grantsFlags &&
        current?.label === next?.label
          ? current
          : next
      );
    };

    syncSelectedMarker();
    editor.on('selectionUpdate', syncSelectedMarker);
    editor.on('transaction', syncSelectedMarker);

    return () => {
      editor.off('selectionUpdate', syncSelectedMarker);
      editor.off('transaction', syncSelectedMarker);
    };
  }, [editor]);

  // 選到不同標記時重設編輯草稿
  useEffect(() => {
    if (!selectedMarker) return;
    setMarkerDraft({
      grantsFlags: selectedMarker.grantsFlags,
      label: selectedMarker.label,
    });
    // 只在切換到不同位置的標記時重設，避免打字中被覆蓋
  }, [selectedMarker?.pos]);

  // 音訊 node Delete/Backspace 攔截
  useEffect(() => {
    if (!editor || !selectedAudio) return;

    const handleAudioDeleteKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!editor.isFocused) return;

      const node = editor.state.doc.nodeAt(selectedAudio.pos);
      if (node?.type.name !== 'inlineAudio') return;

      e.preventDefault();
      e.stopPropagation();
      editor
        .chain()
        .focus()
        .deleteRange({
          from: selectedAudio.pos,
          to: selectedAudio.pos + node.nodeSize,
        })
        .run();
      setSelectedAudio(null);
    };

    document.addEventListener('keydown', handleAudioDeleteKey, true);
    return () =>
      document.removeEventListener('keydown', handleAudioDeleteKey, true);
  }, [editor, selectedAudio]);

  const selectImageBySrc = (src: string) => {
    if (!editor) return;
    let imagePos: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image' && node.attrs.src === src) {
        imagePos = pos;
        return false;
      }
      return true;
    });

    if (imagePos !== null) {
      editor.commands.setNodeSelection(imagePos);
      setSelectedImage({ src, pos: imagePos });
    }
  };

  const toAssetSrc = (key: string) =>
    `/api/assets/${key.split('/').map(encodeURIComponent).join('/')}`;

  const insertOrReplaceImage = (src: string) => {
    if (!editor) return;

    if (imgReplaceMode && selectedImage) {
      const node = editor.state.doc.nodeAt(selectedImage.pos);
      if (node?.type.name === 'image') {
        editor
          .chain()
          .focus()
          .setNodeSelection(selectedImage.pos)
          .updateAttributes('image', { src })
          .run();
        setSelectedImage({ src, pos: selectedImage.pos });
        setMetaDirty(true);
        return;
      }
    }

    const insertPos = editor.state.selection.from;
    editor.chain().focus().setImage({ src }).run();
    requestAnimationFrame(() => {
      const node = editor.state.doc.nodeAt(insertPos);
      if (node?.type.name === 'image') {
        editor.commands.setNodeSelection(insertPos);
        setSelectedImage({ src, pos: insertPos });
        return;
      }
      selectImageBySrc(src);
    });
    setMetaDirty(true);
  };

  const insertImage = () => {
    setImgReplaceMode(false);
    imageInputRef.current?.click();
  };

  const openImagePicker = async (replaceMode = false) => {
    setImgReplaceMode(replaceMode);
    setImgPickerOpen(true);
    setImgPickerLoading(true);
    setImgPickerSearch('');
    try {
      const res = await fetch(`/api/assets?limit=500`);
      if (!res.ok) {
        setImgPickerItems([]);
        return;
      }
      const json = (await res.json()) as {
        ok: boolean;
        data: {
          items: {
            key: string;
            size: number;
            contentType: string;
            originalName: string;
            referenced: boolean;
          }[];
        };
      };
      if (!json.ok) {
        setImgPickerItems([]);
        return;
      }
      const items = json.data.items.filter(
        (i) =>
          i.contentType?.startsWith('image/') || i.key.startsWith('images/')
      );
      items.sort((a, b) => {
        if (a.referenced === b.referenced) return 0;
        return a.referenced ? 1 : -1;
      });
      setImgPickerItems(items);
    } catch {
      setImgPickerItems([]);
    } finally {
      setImgPickerLoading(false);
    }
  };

  const selectFromLibrary = (item: { key: string }) => {
    if (!editor) return;
    insertOrReplaceImage(toAssetSrc(item.key));
    setImgPickerOpen(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editor) return;
    e.target.value = '';

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`/api/assets`, {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (json.ok) {
        const imgUrl = toAssetSrc(json.data.key);
        insertOrReplaceImage(imgUrl);
      } else {
        getToast().error(`Upload failed: ${json.error}`);
      }
    } catch (err: any) {
      getToast().error(`Upload error: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  // === 音訊選擇器 ===
  const openAudioPicker = async (replaceMode = false) => {
    setAudioReplaceMode(replaceMode);
    setAudioPickerOpen(true);
    setAudioPickerLoading(true);
    setAudioPickerSearch('');
    try {
      const res = await fetch(`/api/assets?limit=500`);
      if (!res.ok) {
        setAudioPickerItems([]);
        return;
      }
      const json = (await res.json()) as {
        ok: boolean;
        data: {
          items: {
            key: string;
            size: number;
            contentType: string;
            originalName: string;
            referenced: boolean;
          }[];
        };
      };
      if (!json.ok) {
        setAudioPickerItems([]);
        return;
      }
      const items = json.data.items.filter(
        (i) => i.contentType?.startsWith('audio/') || i.key.startsWith('audio/')
      );
      items.sort((a, b) => {
        if (a.referenced === b.referenced) return 0;
        return a.referenced ? 1 : -1;
      });
      setAudioPickerItems(items);
    } catch {
      setAudioPickerItems([]);
    } finally {
      setAudioPickerLoading(false);
    }
  };

  const insertOrReplaceAudio = (item: {
    key: string;
    originalName?: string;
  }) => {
    if (!editor) return;
    const src = toAssetSrc(item.key);
    const label = item.originalName || item.key.split('/').pop() || '';

    if (audioReplaceMode && selectedAudio) {
      const node = editor.state.doc.nodeAt(selectedAudio.pos);
      if (node?.type.name === 'inlineAudio') {
        editor
          .chain()
          .focus()
          .deleteRange({
            from: selectedAudio.pos,
            to: selectedAudio.pos + node.nodeSize,
          })
          .setInlineAudio({ src, label })
          .run();
      }
    } else {
      editor.chain().focus().setInlineAudio({ src, label }).run();
    }
    setAudioPickerOpen(false);
  };

  // 刪除圖片：僅移除引用
  const handleImageRemoveOnly = () => {
    if (!imgDeleteConfirm || !editor) return;
    const { pos } = imgDeleteConfirm;
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + 1 })
      .run();
    setMetaDirty(true);
    setSelectedImage(null);
    setImgDeleteConfirm(null);
  };

  // 刪除圖片：從媒體庫永久刪除
  const handleImageDeleteFromLibrary = async () => {
    if (!imgDeleteConfirm || !editor) return;
    const { src, pos } = imgDeleteConfirm;
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + 1 })
      .run();
    setMetaDirty(true);
    setSelectedImage(null);
    setImgDeleteConfirm(null);
    const key = extractAssetKey(src);
    if (key) {
      try {
        await deleteAsset(key);
      } catch (err) {
        console.error('刪除媒體庫檔案失敗:', err);
      }
    }
  };

  // === Import / Export MD ===
  // 注意：所有 hooks 必須放在下方 early return 之前，
  // 否則 editor 從 null 變成 instance 時 hooks 數量改變，React 會 throw
  const importMdInputRef = useRef<HTMLInputElement>(null);
  const canImportExport = editorMode.needsTipTap && !!editor && !isEntryMode;

  const handleExportMd = useCallback(() => {
    if (!editor) return;

    // 用自製的 HTML → Markdown 轉換器，保證輸出乾淨的純文字
    const md = htmlToMarkdown(editor.getHTML());

    const frontmatter = [
      '---',
      `title: "${title.replace(/"/g, '\\"')}"`,
      `slug: "${pageSlug}"`,
      `area: "${area}"`,
      `pageType: "${pageType}"`,
      ...(icon ? [`icon: "${icon}"`] : []),
      ...(description
        ? [`description: "${description.replace(/"/g, '\\"')}"`]
        : []),
      `exportedAt: "${new Date().toISOString()}"`,
      '---',
      '',
    ].join('\n');

    const blob = new Blob([frontmatter + md], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(pageSlug || 'page').replace(/\//g, '_')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [editor, title, pageSlug, area, pageType, icon, description]);

  const handleImportMd = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !editor) return;
      e.target.value = '';

      const text = await file.text();
      let content = text;

      // 解析 YAML frontmatter
      const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      if (fmMatch) {
        const fm = fmMatch[1];
        content = fmMatch[2];

        const titleMatch = fm.match(/^title:\s*"?([^"\n]+?)"?\s*$/m);
        if (titleMatch) {
          setTitle(titleMatch[1]);
          setDirtyTitle(true);
        }
        const iconMatch = fm.match(/^icon:\s*"?([^"\n]+?)"?\s*$/m);
        if (iconMatch) {
          setIcon(iconMatch[1]);
          setDirtyMetadata(true);
        }
        const descMatch = fm.match(/^description:\s*"?([^"\n]+?)"?\s*$/m);
        if (descMatch) {
          setDescription(descMatch[1]);
          setDirtyMetadata(true);
        }
      }

      // 設定 TipTap 內容——setContent 預設把字串當 JSON/HTML 處理，
      // 必須指定 contentType: 'markdown' 才會走 Markdown parser
      const trimmed = content.trim();
      if (trimmed) {
        editor.commands.setContent(trimmed, { contentType: 'markdown' });
      } else {
        editor.commands.setContent('<p></p>');
      }
      setEditorDirty(true);
      getToast().success(`已匯入：${file.name}`);
    },
    [editor]
  );

  if (editorMode.needsTipTap && !editor) return null;

  // ── 選取範圍樣式分析 ──
  // 分析選取範圍中的 heading level（排除普通段落，多種 level 時回傳「混合」）
  const getHeadingLabel = (): string => {
    if (!editor) return '內文';
    const { from, to } = editor.state.selection;
    const levels = new Set<number>();
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isTextblock && node.type.name === 'heading') {
        levels.add(node.attrs.level as number);
      }
    });
    if (levels.size === 0) return '內文';
    if (levels.size === 1) return `H${[...levels][0]}`;
    return '混合';
  };

  // 分析選取範圍中的字型（排除未設定字型的文字）
  const getFontLabel = (): string => {
    if (!editor) return 'Font';
    const { from, to } = editor.state.selection;
    // 游標（無選取）：用 getAttributes
    if (from === to) {
      const f = editor.getAttributes('textStyle').fontFamily as
        | string
        | undefined;
      if (!f) return 'Font';
      const entry = FONT_FAMILIES.find((ff) => ff.value === f);
      return entry ? entry.label : f.split(',')[0].replace(/['"]/g, '');
    }
    const fonts = new Set<string>();
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (!node.isText) return;
      const mark = node.marks.find(
        (m) => m.type.name === 'textStyle' && m.attrs.fontFamily
      );
      if (mark) fonts.add(mark.attrs.fontFamily as string);
    });
    if (fonts.size === 0) return 'Font';
    if (fonts.size === 1) {
      const val = [...fonts][0];
      const entry = FONT_FAMILIES.find((ff) => ff.value === val);
      return entry ? entry.label : val.split(',')[0].replace(/['"]/g, '');
    }
    return '混合';
  };

  // 分析選取範圍中的字型大小（排除未設定的文字）
  const getFontSizeLabel = (): string => {
    if (!editor) return '大小';
    const { from, to } = editor.state.selection;
    if (from === to) {
      const s = editor.getAttributes('textStyle').fontSize as
        | string
        | undefined;
      return s ? s.replace('px', '') : '大小';
    }
    const sizes = new Set<string>();
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (!node.isText) return;
      const mark = node.marks.find(
        (m) => m.type.name === 'textStyle' && m.attrs.fontSize
      );
      if (mark) sizes.add(mark.attrs.fontSize as string);
    });
    if (sizes.size === 0) return '大小';
    if (sizes.size === 1) return [...sizes][0].replace('px', '');
    return '混合';
  };

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

  // 開啟 entity 嵌入面板（選取在既有標記上時預填屬性）
  const handleOpenEntityDropdown = () => {
    const attrs = editor.getAttributes('uepEntity');
    setEntityDraft({
      kind: (attrs.kind as string) || 'term',
      ref: (attrs.ref as string) || '',
    });
    setEmbedPickerOpen(false);
    toggleDropdown('uep-entity');
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

  const charCount = editor ? editor.getText().length : 0;

  const statusLabel = {
    idle: '',
    saving: 'saving...',
    saved: 'saved',
    error: 'error',
  }[saveStatus];

  const saveButtonLabel = {
    idle: '儲存',
    saving: '儲存中...',
    saved: '已儲存',
    error: '失敗',
  }[saveStatus];

  return (
    <div
      className="ned-app"
      style={{ '--ned-accent': accentMain } as React.CSSProperties}
    >
      {/* Header */}
      <header className="ned-header">
        {/* 手機版：頁面樹 toggle 按鈕 */}
        {!isPageType && (
          <button
            className={`ned-mobile-toggle ned-mobile-toggle--tree${mobileTreeOpen ? ' is-active' : ''}`}
            onClick={() => {
              setMobileTreeOpen((v) => !v);
              setMobileInspectorOpen(false);
            }}
            title="頁面樹"
          >
            ☰
          </button>
        )}
        <a href="/admin" className="ned-header-area">
          $ admin / {area}
        </a>
        {isEntryMode ? (
          <>
            <div className="ned-header-spacer" />
            <span className="ned-header-status ned-header-status--entry">
              選擇頁面以開始編輯
            </span>
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
                setDirtyTitle(e.target.value !== initialTitleRef.current);
              }}
              placeholder="Page title..."
            />
            <span className="ned-header-status">
              {statusLabel ||
                `${pageStatus} | ${isDirty ? 'modified' : 'saved'}`}
            </span>
            <div className="ned-header-spacer" />
            <div className="ned-header-right">
              {/* 手機版：Inspector toggle */}
              {!isEntryMode && (
                <button
                  className={`ned-mobile-toggle ned-mobile-toggle--inspector${mobileInspectorOpen ? ' is-active' : ''}`}
                  onClick={() => {
                    setMobileInspectorOpen((v) => !v);
                    setMobileTreeOpen(false);
                  }}
                  title="頁面設定"
                >
                  ⚙
                </button>
              )}
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
          {editorMode.needsTipTap && editor && (
            <>
              {/* Heading dropdown */}
              <div className="tb-group">
                <div className="tb-dropdown-wrap">
                  <button
                    className={`tb-btn tb-dropdown-trigger${getHeadingLabel() === '混合' ? ' tb-mixed' : ''}`}
                    onClick={() => toggleDropdown('heading')}
                  >
                    {getHeadingLabel()}
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
                    className={`tb-btn tb-dropdown-trigger${getFontLabel() === '混合' ? ' tb-mixed' : ''}`}
                    onClick={() => toggleDropdown('font')}
                    title="Font"
                  >
                    {getFontLabel()} <span className="tb-caret">&#9662;</span>
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
                    className={`tb-btn tb-dropdown-trigger${getFontSizeLabel() === '混合' ? ' tb-mixed' : ''}`}
                    onClick={() => toggleDropdown('fontSize')}
                    title="字型大小"
                  >
                    {getFontSizeLabel()}
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
                  title="分隔線"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <line x1="3" y1="12" x2="21" y2="12" />
                  </svg>
                </button>
                <button
                  className="tb-btn"
                  onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                  title="程式碼區塊"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                </button>
                <div className="tb-dropdown-wrap">
                  <button
                    className="tb-btn"
                    onClick={() =>
                      setActiveDropdown(
                        activeDropdown === 'image' ? null : 'image'
                      )
                    }
                    title="插入圖片"
                    disabled={uploading}
                  >
                    {uploading ? (
                      '⏳'
                    ) : (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="m21 15-5-5L5 21" />
                      </svg>
                    )}
                  </button>
                  {activeDropdown === 'image' && (
                    <div className="tb-dropdown" style={{ minWidth: 160 }}>
                      <button
                        className="tb-dropdown-item"
                        onClick={() => {
                          setActiveDropdown(null);
                          insertImage();
                        }}
                      >
                        上傳圖片
                      </button>
                      <button
                        className="tb-dropdown-item"
                        onClick={() => {
                          setActiveDropdown(null);
                          void openImagePicker(false);
                        }}
                      >
                        從媒體庫選取
                      </button>
                    </div>
                  )}
                </div>
                {/* 表格 */}
                <div className="tb-dropdown-wrap">
                  <button
                    className={`tb-btn ${editor.isActive('table') ? 'is-active' : ''}`}
                    onClick={() =>
                      setActiveDropdown(
                        activeDropdown === 'table' ? null : 'table'
                      )
                    }
                    title="表格"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <line x1="3" y1="9" x2="21" y2="9" />
                      <line x1="3" y1="15" x2="21" y2="15" />
                      <line x1="9" y1="3" x2="9" y2="21" />
                      <line x1="15" y1="3" x2="15" y2="21" />
                    </svg>
                  </button>
                  {activeDropdown === 'table' && (
                    <div className="tb-dropdown" style={{ minWidth: 180 }}>
                      <button
                        className="tb-dropdown-item"
                        onClick={() => {
                          editor
                            .chain()
                            .focus()
                            .insertTable({
                              rows: 3,
                              cols: 3,
                              withHeaderRow: true,
                            })
                            .run();
                          setActiveDropdown(null);
                        }}
                      >
                        插入表格 3×3
                      </button>
                      <button
                        className="tb-dropdown-item"
                        onClick={() => {
                          editor.chain().focus().addColumnAfter().run();
                          setActiveDropdown(null);
                        }}
                      >
                        向右插入欄
                      </button>
                      <button
                        className="tb-dropdown-item"
                        onClick={() => {
                          editor.chain().focus().addRowAfter().run();
                          setActiveDropdown(null);
                        }}
                      >
                        向下插入列
                      </button>
                      <button
                        className="tb-dropdown-item"
                        onClick={() => {
                          editor.chain().focus().deleteColumn().run();
                          setActiveDropdown(null);
                        }}
                      >
                        刪除此欄
                      </button>
                      <button
                        className="tb-dropdown-item"
                        onClick={() => {
                          editor.chain().focus().deleteRow().run();
                          setActiveDropdown(null);
                        }}
                      >
                        刪除此列
                      </button>
                      <button
                        className="tb-dropdown-item"
                        onClick={() => {
                          editor.chain().focus().deleteTable().run();
                          setActiveDropdown(null);
                        }}
                      >
                        刪除表格
                      </button>
                      <button
                        className="tb-dropdown-item"
                        onClick={() => {
                          editor.chain().focus().mergeCells().run();
                          setActiveDropdown(null);
                        }}
                      >
                        合併儲存格
                      </button>
                      <button
                        className="tb-dropdown-item"
                        onClick={() => {
                          editor.chain().focus().splitCell().run();
                          setActiveDropdown(null);
                        }}
                      >
                        分割儲存格
                      </button>
                      <button
                        className="tb-dropdown-item"
                        onClick={() => {
                          editor.chain().focus().toggleHeaderRow().run();
                          setActiveDropdown(null);
                        }}
                      >
                        切換標題列
                      </button>
                    </div>
                  )}
                </div>
                {/* 音訊 */}
                <button
                  className="tb-btn"
                  onClick={() => void openAudioPicker(false)}
                  title="插入音訊"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
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

              {/* UEP 對話 */}
              <div className="tb-group">
                <button
                  className={`tb-btn tb-btn-uep ${editor.isActive('uepDialogue') ? 'is-active' : ''}`}
                  onClick={() =>
                    editor.chain().focus().toggleUepDialogue().run()
                  }
                  title="UEP 對話 (Ctrl+Shift+U)"
                >
                  <span
                    style={{
                      color: '#D5B618',
                      fontWeight: 700,
                      fontSize: 11,
                    }}
                  >
                    U.E.P
                  </span>
                </button>
                {editor.isActive('uepDialogue') && (
                  <button
                    className="tb-btn"
                    onClick={() => {
                      const current = editor.getAttributes('uepDialogue').side;
                      editor
                        .chain()
                        .focus()
                        .updateAttributes('uepDialogue', {
                          side: current === 'left' ? 'right' : 'left',
                        })
                        .run();
                    }}
                    title="切換左右"
                  >
                    {editor.getAttributes('uepDialogue').side === 'left'
                      ? 'L'
                      : 'R'}
                  </button>
                )}
              </div>

              <div className="tb-sep" />

              {/* 進度標記（Epic 2 掃描線） */}
              <div className="tb-group">
                <button
                  className={`tb-btn ${editor.isActive('progressMarker') ? 'is-active' : ''}`}
                  onClick={() =>
                    editor.chain().focus().setProgressMarker().run()
                  }
                  title="插入進度標記（掃描線標記點，前台隱形）"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                    <line x1="4" y1="22" x2="4" y2="15" />
                  </svg>
                </button>
              </div>

              {/* 嵌入工具（Epic 2 — entity 互動式引用，與旗標工具分開）。
                  僅 history：interactive embedding 是 History 文章專屬
                  （艾斯維爾 2026-07-07 定案），其他區域不出 ◈ 工具。 */}
              {area === 'history' && (
                <>
                  <div className="tb-sep" />

                  <div className="tb-group">
                    <button
                      className={`tb-btn ${editor.isActive('echoSpot') ? 'is-active' : ''}`}
                      type="button"
                      onClick={() => {
                        setSelectedEchoSpot(null);
                        setEchoSongPickerOpen(true);
                      }}
                      title="插入回聲點（掃描線通過時解鎖並嘗試插播）"
                    >
                      ♫
                    </button>
                    {/* Entity 引用 */}
                    <div className="tb-dropdown-wrap">
                      <button
                        className={`tb-btn ${editor.isActive('uepEntity') ? 'is-active' : ''}`}
                        onClick={handleOpenEntityDropdown}
                        title="標記 entity 引用（角色/地點/術語）"
                      >
                        ◈
                      </button>
                      {activeDropdown === 'uep-entity' && (
                        <div className="tb-dropdown tb-link-panel">
                          <select
                            className="tb-embed-kind"
                            value={entityDraft.kind}
                            onChange={(e) =>
                              setEntityDraft((d) => ({
                                ...d,
                                kind: e.target.value,
                              }))
                            }
                          >
                            {ENTITY_KINDS.map((k) => (
                              <option key={k.value} value={k.value}>
                                {k.label}
                              </option>
                            ))}
                          </select>
                          <input
                            className="tb-link-input"
                            type="text"
                            placeholder="引用目標（如 concepts/xxx）"
                            value={entityDraft.ref}
                            onChange={(e) =>
                              setEntityDraft((d) => ({
                                ...d,
                                ref: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setActiveDropdown(null);
                            }}
                            autoFocus
                          />
                          <button
                            className="tb-embed-browse"
                            type="button"
                            onClick={() => setEmbedPickerOpen((v) => !v)}
                          >
                            {embedPickerOpen
                              ? '－ 收合'
                              : '＋ 從 Concepts 條目選擇…'}
                          </button>
                          {embedPickerOpen && (
                            <EntityIndexPicker
                              apiBase={apiBase}
                              onPick={(ref, kind) =>
                                setEntityDraft({ kind, ref })
                              }
                            />
                          )}
                          <div className="tb-link-actions">
                            <button
                              className="tb-link-apply"
                              disabled={!isValidRef(entityDraft.ref.trim())}
                              onClick={() => {
                                editor
                                  .chain()
                                  .focus()
                                  .setUepEntity({
                                    kind: entityDraft.kind,
                                    ref: entityDraft.ref.trim(),
                                  })
                                  .run();
                                setActiveDropdown(null);
                              }}
                            >
                              套用
                            </button>
                            {editor.isActive('uepEntity') && (
                              <button
                                className="tb-link-remove"
                                onClick={() => {
                                  editor.chain().focus().unsetUepEntity().run();
                                  setActiveDropdown(null);
                                }}
                              >
                                移除標記
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Cue 工具已撤下（艾斯維爾 2026-07-03 驗收定案）：
                    song 不是嵌入而是旗標式播放觸發點（掃描線經過即播放）、
                    image 是浮動按鈕（小說插圖式，連動 Visuals 浮島）。
                    兩者的編輯器應用與浮島行為綁定，拆到浮島階段實作。
                    UepCueMark extension 與 embed 格式層保留（無內容寫入）。 */}
                  </div>

                  {/* 點擊已嵌入實體文字的浮動資訊 chip（S7 驗收 #8） */}
                  <EntityInfoChip
                    editor={editor}
                    onEdit={handleOpenEntityDropdown}
                  />
                </>
              )}

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
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
                    <path d="M22 21H7" />
                    <path d="m5 11 9 9" />
                  </svg>
                </button>
              </div>
            </>
          )}

          <span className="ned-toolbar-right">
            <button
              className="tb-btn ned-io-btn"
              disabled={!canImportExport}
              onClick={() => importMdInputRef.current?.click()}
              title={
                canImportExport ? '匯入 Markdown (.md)' : '此模式不支援匯入'
              }
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span className="ned-io-label">匯入</span>
            </button>
            <button
              className="tb-btn ned-io-btn"
              disabled={!canImportExport}
              onClick={handleExportMd}
              title={
                canImportExport ? '匯出為 Markdown (.md)' : '此模式不支援匯出'
              }
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span className="ned-io-label">匯出</span>
            </button>
            <span className="ned-io-sep" />
            {editorMode.toolbarLabel}
            {editorMode.needsTipTap && ` | ${charCount.toLocaleString()} chars`}
          </span>
        </div>
      )}

      {/* 手機版抽屜遮罩 */}
      {(mobileTreeOpen || mobileInspectorOpen) && (
        <div
          className="ned-mobile-backdrop"
          onClick={() => {
            setMobileTreeOpen(false);
            setMobileInspectorOpen(false);
          }}
        />
      )}

      {/* Body — 3 columns (or 2 in homepage mode) */}
      <div className={`ned-body ${isPageType ? 'ned-body--no-tree' : ''}`}>
        {/* Left — Page Tree (hidden in homepage mode) */}
        {!isPageType && (
          <aside
            className={`ned-panel--tree${mobileTreeOpen ? ' ned-panel--mobile-open' : ''}`}
          >
            <EditorPageTree
              area={area}
              apiBase={apiBase}
              currentSlug={pageSlug}
              accent={accentMain}
              refreshKey={treeRefreshKey}
              beforeNavigate={handleBeforeNavigate}
            />
          </aside>
        )}

        {/* Middle — Editor */}
        <main className="ned-editor">
          {isEntryMode ? (
            <div className="ned-empty-state">
              <div className="ned-empty-icon" style={{ color: accentMain }}>
                &#9998;
              </div>
              <div className="ned-empty-title">選擇一個項目開始編輯</div>
              <div className="ned-empty-desc ned-empty-desc--desktop">
                從左側的頁面樹點選要編輯的章節或段落，
                <br />
                或在項目之間 hover 來新增頁面。
              </div>
              <div className="ned-empty-desc ned-empty-desc--mobile">
                點選左上角 ☰ 開啟頁面樹，
                <br />
                選擇要編輯的章節或段落。
              </div>
              {!isPageType && (
                <button
                  className="ned-empty-open-tree"
                  onClick={() => setMobileTreeOpen(true)}
                  style={{ borderColor: accentMain, color: accentMain }}
                >
                  ☰ 開啟頁面樹
                </button>
              )}
            </div>
          ) : (
            <>
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
                    apiBase={apiBase}
                    songId={currentPageId}
                    onDataChange={setEchoesData}
                    onDirty={() => setMetaDirty(true)}
                    onValidationChange={setEchoesValidationIssues}
                  />
                ) : isVisuals ? (
                  <VisualsEditorBody
                    accent={accentMain}
                    initialData={visualsData}
                    onDataChange={setVisualsData}
                    onDirty={() => setMetaDirty(true)}
                  />
                ) : isStorageDialogue ? (
                  <>
                    {needsSubcatSelector && availableSubcats.length > 0 && (
                      <div className="ned-subcat-selector">
                        <label className="ned-subcat-selector-label">
                          分類
                        </label>
                        <select
                          className="ned-subcat-selector-select"
                          value={storageSubcat}
                          onChange={(e) => {
                            setStorageSubcat(e.target.value);
                            setMetaDirty(true);
                          }}
                        >
                          <option value="">（未分類）</option>
                          {availableSubcats
                            .filter((s) => !s.hidden)
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.icon ? `${s.icon} ` : ''}
                                {s.label}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}
                    <StorageDialogueEditor
                      accent={accentMain}
                      initialContentBlocks={initialContentBlocks || []}
                      onContentChange={setStorageDialogueBlocks}
                      onDirty={() => setDirtyStructured(true)}
                    />
                  </>
                ) : isStorageChangelog ? (
                  <ChangelogEditorBody
                    accent={accentMain}
                    initialContentBlocks={initialContentBlocks || []}
                    onContentChange={setChangelogBlocks}
                    onDirty={() => setDirtyStructured(true)}
                    meta={changelogMeta}
                    onMetaChange={setChangelogMeta}
                  />
                ) : (
                  <>
                    {isStorageExtras && (
                      <ThoughtStream
                        accent={accentMain}
                        onPushToEditor={(html) => {
                          if (editor) {
                            editor.chain().focus().insertContent(html).run();
                            setEditorDirty(true);
                          }
                        }}
                      />
                    )}
                    {needsSubcatSelector && availableSubcats.length > 0 && (
                      <div className="ned-subcat-selector">
                        <label className="ned-subcat-selector-label">
                          分類
                        </label>
                        <select
                          className="ned-subcat-selector-select"
                          value={storageSubcat}
                          onChange={(e) => {
                            setStorageSubcat(e.target.value);
                            setMetaDirty(true);
                          }}
                        >
                          <option value="">（未分類）</option>
                          {availableSubcats
                            .filter((s) => !s.hidden)
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.icon ? `${s.icon} ` : ''}
                                {s.label}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}
                    <EditorContent editor={editor} />
                    {isStorageClearing && (
                      <StorageSubcatEditor
                        subcategories={storageSubcats}
                        onChange={(next) => {
                          setStorageSubcats(next);
                          setMetaDirty(true);
                        }}
                        accent={accentMain}
                      />
                    )}
                    {isConcepts && (
                      <ConceptsEditorBody
                        accent={accentMain}
                        stackStyle={
                          conceptsStackStyle as
                            | 'dossier'
                            | 'browser'
                            | 'chrono'
                            | 'diff'
                        }
                        initialData={conceptsData}
                        onDataChange={setConceptsData}
                        onDirty={setConceptsDirty}
                      />
                    )}
                    {isEchoesSubcat && (
                      <EchoesSubcatEditor
                        area={area}
                        apiBase={apiBase}
                        pageId={currentPageId}
                        pageSlug={pageSlug}
                        accent={accentMain}
                        onDirty={() => setMetaDirty(true)}
                        refreshKey={treeRefreshKey}
                      />
                    )}
                    {isVisualsSubcat && (
                      <VisualsSubcatEditor
                        area={area}
                        apiBase={apiBase}
                        pageId={currentPageId}
                        pageSlug={pageSlug}
                        accent={accentMain}
                        onDirty={() => setMetaDirty(true)}
                        refreshKey={treeRefreshKey}
                      />
                    )}
                    {isZone && (
                      <ZoneTabsEditor
                        area={area}
                        apiBase={apiBase}
                        pageId={currentPageId}
                        accent={accentMain}
                        zoneTabs={zoneTabs}
                        onZoneTabsChange={(tabs) => {
                          setZoneTabs(tabs);
                          setMetaDirty(true);
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
          <aside
            className={`ned-panel--inspector${mobileInspectorOpen ? ' ned-panel--mobile-open' : ''}`}
          >
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
              onDirty={() => setDirtyMetadata(true)}
              accent={accentMain}
              pageStatus={pageStatus}
              createdAt={createdAt}
              updatedAt={updatedAt}
              gateFields={
                <GateConditionEditor
                  value={gate}
                  onChange={(next) => {
                    setGate(next);
                    setDirtyMetadata(true);
                  }}
                  isProgressPage={progressPage}
                  onProgressPageChange={(next) => {
                    setProgressPage(next);
                    setDirtyMetadata(true);
                  }}
                  isGateExempt={gateExempt}
                  onGateExemptChange={(next) => {
                    setGateExempt(next);
                    setDirtyMetadata(true);
                  }}
                  parentIsProgressContainer={parentIsProgressContainer}
                  apiBase={apiBase}
                  accent={accentMain}
                />
              }
              modeFields={
                <>
                  {modeId === 'visuals.division' && (
                    <InspectorSection label="default layout">
                      <select
                        className="ned-field"
                        value={layout || ''}
                        onChange={(e) => {
                          setLayout(e.target.value);
                          setDirtyMetadata(true);
                        }}
                      >
                        {LAYOUT_OPTIONS.filter((o) => o.value !== '').map(
                          (o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          )
                        )}
                      </select>
                    </InspectorSection>
                  )}
                </>
              }
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
      {/* Hidden file input for MD import */}
      <input
        ref={importMdInputRef}
        type="file"
        accept=".md,.markdown,.txt"
        style={{ display: 'none' }}
        onChange={handleImportMd}
      />

      {/* 圖片浮動操作列 */}
      {editor &&
        selectedImage &&
        (() => {
          const imgSrc = selectedImage.src;
          const pos = selectedImage.pos;
          return (
            <div className="ned-img-bubble" key="img-bubble">
              <button
                className="ned-img-bubble-btn"
                title="替換圖片（上傳）"
                onClick={() => {
                  setImgReplaceMode(true);
                  imageInputRef.current?.click();
                }}
              >
                上傳替換
              </button>
              <button
                className="ned-img-bubble-btn"
                title="替換圖片（媒體庫）"
                onClick={() => void openImagePicker(true)}
              >
                媒體庫替換
              </button>
              <button
                className="ned-img-bubble-btn ned-img-bubble-btn--danger"
                title="刪除圖片"
                onClick={() => setImgDeleteConfirm({ src: imgSrc, pos })}
              >
                刪除
              </button>
            </div>
          );
        })()}

      {/* 圖片選擇器 Modal */}
      {imgPickerOpen && (
        <div
          className="ned-modal-backdrop"
          onClick={() => setImgPickerOpen(false)}
        >
          <div
            className="ned-modal-card"
            style={{ maxWidth: 640, maxHeight: '80vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ned-modal-header">
              <div>
                <strong>從媒體庫選擇圖片</strong>
                <span
                  style={{
                    marginLeft: 10,
                    fontSize: '0.85em',
                    color: 'var(--ink-mute, #888)',
                  }}
                >
                  {imgReplaceMode ? '選擇圖片以替換' : '選擇圖片以插入'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="text"
                  className="ned-media-picker-search"
                  placeholder="搜尋..."
                  value={imgPickerSearch}
                  onChange={(e) => setImgPickerSearch(e.target.value)}
                />
                <button
                  type="button"
                  className="ned-media-picker-close"
                  onClick={() => setImgPickerOpen(false)}
                  aria-label="關閉媒體庫"
                  title="關閉"
                >
                  ×
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
              {imgPickerLoading ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: 32,
                    color: 'var(--ink-mute, #888)',
                  }}
                >
                  載入中...
                </div>
              ) : imgPickerItems.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: 32,
                    color: 'var(--ink-mute, #888)',
                  }}
                >
                  媒體庫中沒有圖片
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fill, minmax(120px, 1fr))',
                    gap: 8,
                  }}
                >
                  {imgPickerItems
                    .filter((item) => {
                      if (!imgPickerSearch) return true;
                      const name = (
                        item.originalName || item.key
                      ).toLowerCase();
                      return name.includes(imgPickerSearch.toLowerCase());
                    })
                    .map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => selectFromLibrary(item)}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          border: '1px solid var(--line, #333)',
                          background: 'transparent',
                          borderRadius: 6,
                          overflow: 'hidden',
                          cursor: 'pointer',
                          padding: 0,
                          color: 'var(--ink, #ccc)',
                        }}
                      >
                        <img
                          src={`${apiBase}/api/assets/${item.key.split('/').map(encodeURIComponent).join('/')}`}
                          alt=""
                          style={{
                            width: '100%',
                            aspectRatio: '1',
                            objectFit: 'cover',
                          }}
                        />
                        <div
                          style={{
                            padding: '4px 6px',
                            fontSize: '0.75em',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.originalName || item.key.split('/').pop()}
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 圖片刪除確認 Dialog */}
      {imgDeleteConfirm && (
        <div
          className="ned-modal-backdrop"
          onClick={() => setImgDeleteConfirm(null)}
        >
          <div
            className="ned-modal-card"
            style={{ maxWidth: 400, padding: '24px 28px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{ fontWeight: 600, marginBottom: 8, fontSize: '1.05em' }}
            >
              刪除圖片
            </div>
            <div
              style={{
                fontSize: '0.85em',
                color: 'var(--ink-mute, #888)',
                marginBottom: 16,
                wordBreak: 'break-all',
              }}
            >
              {imgDeleteConfirm.src.split('/').pop()}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                type="button"
                className="ned-btn-ghost"
                onClick={handleImageRemoveOnly}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  textAlign: 'left',
                }}
              >
                僅從編輯器移除
                <span
                  style={{
                    display: 'block',
                    fontSize: '0.8em',
                    color: 'var(--ink-mute, #888)',
                    marginTop: 2,
                  }}
                >
                  檔案保留在媒體庫中，可供其他頁面使用
                </span>
              </button>
              <button
                type="button"
                className="ned-btn-ghost"
                onClick={() => void handleImageDeleteFromLibrary()}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  textAlign: 'left',
                  borderColor: 'crimson',
                  color: 'crimson',
                }}
              >
                從媒體庫永久刪除
                <span
                  style={{
                    display: 'block',
                    fontSize: '0.8em',
                    color: 'var(--ink-mute, #888)',
                    marginTop: 2,
                  }}
                >
                  移除引用並從 R2 儲存空間中刪除檔案
                </span>
              </button>
              <button
                type="button"
                className="ned-btn-ghost"
                onClick={() => setImgDeleteConfirm(null)}
                style={{
                  width: '100%',
                  padding: '8px 16px',
                  textAlign: 'center',
                  marginTop: 4,
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 音訊 bubble menu */}
      {editor &&
        selectedAudio &&
        (() => {
          return (
            <div className="ned-audio-bubble" key="audio-bubble">
              <span
                className="ned-audio-bubble-label"
                title={selectedAudio.src}
              >
                ♪ {selectedAudio.label || '音訊節點'}
              </span>
              <button
                className="ned-img-bubble-btn"
                title="替換音訊"
                onClick={() => void openAudioPicker(true)}
              >
                替換
              </button>
              <button
                className="ned-img-bubble-btn ned-img-bubble-btn--danger"
                title="刪除音訊"
                onClick={() => {
                  const node = editor.state.doc.nodeAt(selectedAudio.pos);
                  if (node?.type.name === 'inlineAudio') {
                    editor
                      .chain()
                      .focus()
                      .deleteRange({
                        from: selectedAudio.pos,
                        to: selectedAudio.pos + node.nodeSize,
                      })
                      .run();
                  }
                  setSelectedAudio(null);
                }}
              >
                刪除
              </button>
            </div>
          );
        })()}

      {/* 進度標記 bubble menu（Epic 2 掃描線） */}
      {editor && selectedMarker && (
        <div className="ned-audio-bubble ned-marker-bubble" key="marker-bubble">
          <span className="ned-audio-bubble-label">
            ⚑ {markerDraft.grantsFlags.trim() ? '旗標標記' : '進度標記'}
          </span>
          <input
            className="ned-marker-input"
            type="text"
            placeholder="備註（僅編輯器可見）"
            value={markerDraft.label}
            onChange={(e) =>
              setMarkerDraft((d) => ({ ...d, label: e.target.value }))
            }
          />
          <input
            className="ned-marker-input ned-marker-input--flags"
            type="text"
            placeholder="授予旗標（逗號分隔）"
            value={markerDraft.grantsFlags}
            onChange={(e) =>
              setMarkerDraft((d) => ({ ...d, grantsFlags: e.target.value }))
            }
          />
          <button
            className="ned-img-bubble-btn"
            title="套用標記設定"
            onClick={() => {
              const node = editor.state.doc.nodeAt(selectedMarker.pos);
              if (node?.type.name !== 'progressMarker') return;
              editor.view.dispatch(
                editor.state.tr.setNodeMarkup(selectedMarker.pos, undefined, {
                  grantsFlags: parseFlagsAttr(markerDraft.grantsFlags),
                  label: markerDraft.label.trim(),
                })
              );
            }}
          >
            套用
          </button>
          <button
            className="ned-img-bubble-btn ned-img-bubble-btn--danger"
            title="刪除標記"
            onClick={() => {
              const node = editor.state.doc.nodeAt(selectedMarker.pos);
              if (node?.type.name === 'progressMarker') {
                editor
                  .chain()
                  .focus()
                  .deleteRange({
                    from: selectedMarker.pos,
                    to: selectedMarker.pos + node.nodeSize,
                  })
                  .run();
              }
              setSelectedMarker(null);
            }}
          >
            刪除
          </button>
        </div>
      )}

      {/* Echo Spot bubble：已插入節點可重新綁曲或刪除。 */}
      {editor && selectedEchoSpot && (
        <div className="ned-audio-bubble ned-echo-spot-bubble">
          <span className="ned-audio-bubble-label">
            ♫ {selectedEchoSpot.title || selectedEchoSpot.songId}
          </span>
          <span className="ned-echo-spot-bubble__meta">
            {selectedEchoSpot.entityKey || '無 entityKey'}
          </span>
          <button
            type="button"
            className="ned-img-bubble-btn"
            onClick={() => setEchoSongPickerOpen(true)}
          >
            重新選曲
          </button>
          <button
            type="button"
            className="ned-img-bubble-btn ned-img-bubble-btn--danger"
            onClick={() => {
              const node = editor.state.doc.nodeAt(selectedEchoSpot.pos);
              if (node?.type.name === 'echoSpot') {
                editor
                  .chain()
                  .focus()
                  .deleteRange({
                    from: selectedEchoSpot.pos,
                    to: selectedEchoSpot.pos + node.nodeSize,
                  })
                  .run();
              }
              setSelectedEchoSpot(null);
            }}
          >
            刪除
          </button>
        </div>
      )}

      <EchoSongPicker
        apiBase={apiBase}
        open={echoSongPickerOpen}
        onClose={() => setEchoSongPickerOpen(false)}
        onSelect={applyEchoSongChoice}
      />

      {/* 音訊選擇器 Modal */}
      {audioPickerOpen && (
        <div
          className="ned-modal-backdrop"
          onClick={() => setAudioPickerOpen(false)}
        >
          <div
            className="ned-modal-card"
            style={{ maxWidth: 560, maxHeight: '70vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ned-modal-header">
              <div>
                <strong>{audioReplaceMode ? '替換音訊' : '插入音訊'}</strong>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="text"
                  placeholder="搜尋..."
                  value={audioPickerSearch}
                  onChange={(e) => setAudioPickerSearch(e.target.value)}
                  style={{
                    background: 'var(--bg-deep, #111)',
                    border: '1px solid var(--line, #333)',
                    borderRadius: 6,
                    padding: '4px 10px',
                    fontSize: '0.85em',
                    color: 'var(--ink, #ccc)',
                    width: 160,
                  }}
                />
                <button
                  type="button"
                  onClick={() => setAudioPickerOpen(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--ink, #ccc)',
                    fontSize: 20,
                    cursor: 'pointer',
                    padding: '0 4px',
                  }}
                >
                  關閉
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
              {audioPickerLoading ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: 32,
                    color: 'var(--ink-mute, #888)',
                  }}
                >
                  載入中...
                </div>
              ) : audioPickerItems.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: 32,
                    color: 'var(--ink-mute, #888)',
                  }}
                >
                  媒體庫中沒有音訊檔案
                </div>
              ) : (
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                >
                  {audioPickerItems
                    .filter((item) => {
                      if (!audioPickerSearch) return true;
                      const name = (
                        item.originalName || item.key
                      ).toLowerCase();
                      return name.includes(audioPickerSearch.toLowerCase());
                    })
                    .map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => insertOrReplaceAudio(item)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          width: '100%',
                          padding: '10px 12px',
                          background: 'none',
                          border: '1px solid transparent',
                          borderRadius: 6,
                          cursor: 'pointer',
                          color: 'var(--ink, #ccc)',
                          textAlign: 'left',
                          transition: 'background 0.12s, border-color 0.12s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background =
                            'rgba(255,255,255,0.04)';
                          e.currentTarget.style.borderColor =
                            'var(--line, #333)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'none';
                          e.currentTarget.style.borderColor = 'transparent';
                        }}
                      >
                        <span style={{ fontSize: 20, flexShrink: 0 }}>♪</span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {item.originalName || item.key.split('/').pop()}
                          </div>
                          <div
                            style={{
                              fontSize: '0.8em',
                              color: 'var(--ink-mute, #888)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {item.key}
                          </div>
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
