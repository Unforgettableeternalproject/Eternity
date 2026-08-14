/* global AbortController */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import SpriteEditorModal from './SpriteEditorModal';
import {
  getDialog,
  buildAssetUrl as buildImageUrl,
  uploadAsset,
  deleteAsset,
  fetchImageAssets,
  type AssetItem as ImagePickerItem,
} from './editorHelpers';
import EntityKeyField, { ENTITY_KEY_PATTERN } from './EntityKeyField';
import GateConditionEditor from './GateConditionEditor';
import { UploadSpinner } from './UploadSpinner';
import { isSamePagePath } from '../../lib/pagePath';
import type { GateCondition } from '../../progress';
import type { ImageDisplayState } from '../../visuals';

// ──────────────────────────────────────────────────────────────
//  型別定義
// ──────────────────────────────────────────────────────────────

/** 精靈圖動畫定義：動畫名稱 → [起始幀, 結束幀] */
export interface SpriteAnimations {
  [name: string]: [number, number];
}

export interface ImageItem {
  /** 頁面內唯一 ID */
  id: string;
  /** R2 key (images/xxx.png) */
  file: string;
  /** 圖片說明 */
  caption: string;
  /** 排序 */
  sortOrder: number;

  // ── 精靈圖專用欄位（僅當 isSpriteSheet = true 時填入）──
  /** 標記為精靈圖 */
  isSpriteSheet?: boolean;
  /** 單幀寬度 (px) */
  frameWidth?: number;
  /** 單幀高度 (px) */
  frameHeight?: number;
  /** 總幀數 */
  frameCount?: number;
  /** 橫向格數 */
  columns?: number;
  /** 縱向格數 */
  rows?: number;
  /** 預設播放速率 (幀/秒) */
  fps?: number;
  /** 具名動畫定義 */
  animations?: SpriteAnimations;
  /** 基準像素大小（展示縮放用） */
  basePixelSize?: number;

  // ── 三態解鎖欄位（S8 下半場 §1-2；未設定＝天生解鎖）──
  // 第一張圖（sortOrder 排序後）不吃這些欄位——恆等於 gallery 解鎖。
  // 精靈圖（isSpriteSheet）本輪不接三態。
  /** 初始狀態：locked / partial / unlocked（預設 unlocked） */
  initialState?: ImageDisplayState;
  /** 鎖定條件：離開鎖定態的閘 */
  lockGate?: GateCondition | null;
  /** 部分鎖定條件：離開部分解鎖態的閘 */
  partialGate?: GateCondition | null;
}

export interface VisualsData {
  /** 頁面內的圖片陣列 */
  images: ImageItem[];
  /** 分組標籤（同 group 的 gallery 在 subcat 中歸在一起）*/
  group: string;
  /**
   * gallery 解鎖閘（GateCondition 物件；null = 無條件）的唯讀鏡像。
   * 單一寫入來源是 Inspector 的 PROGRESS GATE 面板（RichEditor `gate`
   * state → metadata.gate）——serializeVisualsData 不再輸出 gate，
   * 避免 Echoes D 段踩過的「兩個編輯器互相覆蓋 metadata.gate」bug。
   */
  gate: GateCondition | null;
  /**
   * 解鎖提示文案（metadata.gateHint）：鎖定 gallery 的封印面板顯示的
   * 劇情提示，不參與條件求值。讀取相容舊自由文字 gate 字串（2026-07-19
   * 拍板：靜默失效，僅承接為提示文案）——同 Echoes spoilerGate 手法。
   */
  gateHint: string;
  /**
   * entityKey（僅陳列走廊 profiles）：Interactive Embedding 反查用，
   * 同 zone 唯一（V-B 編輯器驗證）
   */
  entityKey: string;
  /**
   * 劇情點 key（僅鑲框室 illustrations）：Visual Clue 引用用，
   * 同 zone 唯一（V-B 編輯器驗證）。S10-1 起取代原本的 illustrationId，
   * 與 Echoes 劇情歌共用同一個 storyKey 命名空間——同一個劇情點可以
   * 同時掛一首歌與一張插圖，這正是共享識別碼的初衷。
   */
  storyKey: string;
  /** 展示風格 */
  layout: string;
}

/**
 * 正規化 metadata.gate 的物件形狀為 GateCondition。
 * 非物件（含舊自由文字字串）、空條件一律回 null。
 */
export function normalizeGateObject(value: unknown): GateCondition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const requiresFlags = Array.isArray(raw.requiresFlags)
    ? raw.requiresFlags.filter(
        (f): f is string => typeof f === 'string' && f.trim().length > 0
      )
    : [];
  const pristineOnly = raw.pristineOnly === true;
  if (requiresFlags.length === 0 && !pristineOnly) return null;
  const gate: GateCondition = {};
  if (requiresFlags.length > 0) gate.requiresFlags = requiresFlags;
  if (pristineOnly) gate.pristineOnly = true;
  return gate;
}

export const LAYOUT_OPTIONS = [
  { value: '', label: '繼承 (使用上層設定)' },
  { value: 'corridor', label: '走廊透視 (Corridor)' },
  { value: 'museum', label: '鑲框展示 (Museum)' },
  { value: 'pinboard', label: '布告欄 (Pinboard)' },
  { value: 'pixel', label: '像素格 (Pixel)' },
  { value: 'sprite', label: '精靈圖檢視器 (Sprite)' },
] as const;

export function parseVisualsData(metadata: Record<string, any>): VisualsData {
  const rawGate = metadata?.gate;
  return {
    // 依 sortOrder 正規化陣列順序（穩定排序，與 runtime 的
    // resolveGalleryImages 同構）——編輯器以 index 0 落實「第一張圖
    // 恆等式」，匯入/舊資料的陣列順序與 sortOrder 不一致時，未正規化
    // 會鎖錯圖片
    images: Array.isArray(metadata?.images)
      ? [...metadata.images].sort(
          (a, b) => (a?.sortOrder ?? 0) - (b?.sortOrder ?? 0)
        )
      : [],
    group: metadata?.group || '',
    // 物件 → 結構化閘（唯讀鏡像）；字串 → 舊資料靜默失效
    gate: normalizeGateObject(rawGate),
    // 提示文案：新 key gateHint 優先，舊字串 gate 讀取相容
    gateHint:
      typeof metadata?.gateHint === 'string'
        ? metadata.gateHint
        : typeof rawGate === 'string'
          ? rawGate
          : '',
    entityKey:
      typeof metadata?.entityKey === 'string' ? metadata.entityKey : '',
    storyKey: typeof metadata?.storyKey === 'string' ? metadata.storyKey : '',
    layout: metadata?.layout || '',
  };
}

export function serializeVisualsData(data: VisualsData): Record<string, any> {
  return {
    images: data.images,
    group: data.group || undefined,
    // 不輸出 spoilerLevel——Visuals 已排除 spoiler 降級鏈（艾斯維爾 07/20
    // 驗收定案：gallery 級遮蔽等級整個退場，劇透防護由 per-image 三態
    // 承擔），舊值於下次存檔時卸下
    // 不輸出 gate——結構化閘由 Inspector PROGRESS GATE 面板單一來源保存；
    // 舊自由文字 gate 承接進 gateHint 後即從 metadata.gate 卸下
    gateHint: data.gateHint.trim() || undefined,
    entityKey: data.entityKey.trim() || undefined,
    storyKey: data.storyKey.trim() || undefined,
    layout: data.layout || undefined,
  };
}

// ──────────────────────────────────────────────────────────────
//  圖片三態行為鏈描述（S8 下半場 V-B.17）
// ──────────────────────────────────────────────────────────────

/**
 * 依 8 案狀態機（設計文件 §1-3）描述當前組合的行為鏈，
 * 讓編輯者所見即所得。warn = 案 8（partialGate 形同虛設，
 * 拍板：提示不阻擋）。
 */
export function describeImageChain(
  initialState: ImageDisplayState,
  hasLockGate: boolean,
  hasPartialGate: boolean
): { text: string; warn: boolean } {
  if (initialState === 'unlocked') {
    // 案 7
    return { text: '永遠解鎖——條件全部不生效', warn: false };
  }
  if (initialState === 'partial') {
    if (hasPartialGate) {
      // 案 4/5 前者
      return {
        text: hasLockGate
          ? '部分解鎖 →(部分條件)→ 解鎖（鎖定條件不生效）'
          : '部分解鎖 →(部分條件)→ 解鎖',
        warn: false,
      };
    }
    if (hasLockGate) {
      // 案 5
      return {
        text: '部分解鎖 →(鎖定條件視為離開條件)→ 解鎖',
        warn: false,
      };
    }
    // 案 6
    return { text: '永遠部分解鎖', warn: false };
  }
  // initialState === 'locked'
  if (hasLockGate) {
    return hasPartialGate
      ? { text: '鎖定 →(鎖定條件)→ 部分解鎖 →(部分條件)→ 解鎖', warn: false } // 案 1
      : { text: '鎖定 →(鎖定條件)→ 解鎖（跳過部分解鎖）', warn: false }; // 案 2
  }
  if (hasPartialGate) {
    // 案 8：提示不阻擋
    return {
      text: '永遠鎖定——沒有鎖定條件就無法離開鎖定態，部分條件不會生效',
      warn: true,
    };
  }
  // 案 3
  return { text: '永遠鎖定（未釋出內容）', warn: false };
}

// ──────────────────────────────────────────────────────────────
//  分館規則與唯一性收集（S8 下半場 V-B.16）
// ──────────────────────────────────────────────────────────────

/**
 * 從 pageSlug（不含 area 前綴，如 `profiles/characters/xxx`）推導
 * gallery 所屬分館 id——與 content-api 的 divisionId 推導同構
 * （`visuals/{division}/...` 第二段）。
 */
export function deriveDivisionId(pageSlug: string): string {
  return pageSlug.split('/')[0] || '';
}

interface VisualsTreeNodeForKeys {
  id: string;
  pageType?: string;
  metadata?: { entityKey?: unknown; storyKey?: unknown };
  children?: VisualsTreeNodeForKeys[];
}

/**
 * 收集同 zone 其他 gallery 的 entityKey / storyKey（排除自身），
 * 唯一性硬驗證用——比照 Echoes collectOtherEchoesEntityKeys。
 */
export function collectOtherVisualsGalleryKeys(
  nodes: VisualsTreeNodeForKeys[],
  galleryId: string
): { entityKeys: Set<string>; storyKeys: Set<string> } {
  const entityKeys = new Set<string>();
  const storyKeys = new Set<string>();
  const walk = (items: VisualsTreeNodeForKeys[]) => {
    for (const node of items) {
      if (node.pageType === 'gallery' && !isSamePagePath(node.id, galleryId)) {
        const key = node.metadata?.entityKey;
        if (typeof key === 'string' && key.trim()) entityKeys.add(key.trim());
        const story = node.metadata?.storyKey;
        if (typeof story === 'string' && story.trim())
          storyKeys.add(story.trim());
      }
      if (Array.isArray(node.children)) walk(node.children);
    }
  };
  walk(nodes);
  return { entityKeys, storyKeys };
}

// ──────────────────────────────────────────────────────────────
//  工具函式
// ──────────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// uploadAsset, fetchImageAssets, buildImageUrl, deleteAsset 已移至 editorHelpers.ts

/** 三態初始狀態選項（A/B/C，設計文件 §1-2） */
const IMAGE_STATE_OPTIONS: {
  value: ImageDisplayState;
  code: string;
  label: string;
}[] = [
  { value: 'locked', code: 'A', label: '鎖定' },
  { value: 'partial', code: 'B', label: '部分解鎖' },
  { value: 'unlocked', code: 'C', label: '解鎖' },
];

// ──────────────────────────────────────────────────────────────
//  主元件
// ──────────────────────────────────────────────────────────────

interface VisualsEditorBodyProps {
  accent: string;
  initialData: VisualsData;
  apiBase: string;
  /** gallery 頁 id（含 area 前綴，如 visuals/profiles/...） */
  galleryId: string;
  /** 頁 slug（不含 area 前綴）——分館推導用 */
  pageSlug: string;
  onDataChange: (data: VisualsData) => void;
  onDirty: () => void;
  /** 驗證問題回報——存檔前 RichEditor 據此阻擋（同 Echoes 模式） */
  onValidationChange?: (issues: string[]) => void;
}

export default function VisualsEditorBody({
  accent,
  initialData,
  apiBase,
  galleryId,
  pageSlug,
  onDataChange,
  onDirty,
  onValidationChange,
}: VisualsEditorBodyProps) {
  const [data, setData] = useState<VisualsData>(initialData);
  const [uploading, setUploading] = useState(false);
  /** 多檔上傳的第 N 張——單檔時 total 為 1，spinner 自動省略計數 */
  const [uploadProgress, setUploadProgress] = useState({
    current: 0,
    total: 0,
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 替換中的圖片 id——替換共用同一個隱藏 input，靠這個決定寫回哪一筆 */
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);

  // 分館規則：entityKey 僅陳列走廊（profiles）、storyKey 僅鑲框室
  // （illustrations）——依 division 顯隱（§1-1）
  const divisionId = deriveDivisionId(pageSlug);
  const showEntityKey = divisionId === 'profiles';
  const showStoryKey = divisionId === 'illustrations';

  // 唯一性硬驗證：同 zone 唯一，查核失敗阻擋存檔可重試（比照 Echoes）
  const [otherKeys, setOtherKeys] = useState<{
    entityKeys: Set<string>;
    storyKeys: Set<string>;
  }>(() => ({ entityKeys: new Set(), storyKeys: new Set() }));
  const [keyCheckStatus, setKeyCheckStatus] = useState<
    'loading' | 'ready' | 'error'
  >('loading');
  const [keyCheckReload, setKeyCheckReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setKeyCheckStatus('loading');
    fetch(`${apiBase}/api/content/visuals/tree`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (!payload?.ok || !Array.isArray(payload.data)) {
          throw new Error('Visuals tree payload 格式錯誤');
        }
        setOtherKeys(collectOtherVisualsGalleryKeys(payload.data, galleryId));
        setKeyCheckStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setKeyCheckStatus('error');
      });
    return () => controller.abort();
  }, [apiBase, galleryId, keyCheckReload]);

  const validationIssues = useMemo(() => {
    const issues: string[] = [];
    const checkKey = (
      label: string,
      value: string,
      taken: Set<string>,
      takenMessage: string
    ) => {
      const key = value.trim();
      if (!key) return;
      if (!ENTITY_KEY_PATTERN.test(key)) {
        issues.push(`${label}「${key}」不是合法 kebab-case`);
      } else if (keyCheckStatus === 'loading') {
        issues.push(`正在查核${label}唯一性，請稍候`);
      } else if (keyCheckStatus === 'error') {
        issues.push(`無法查核${label}唯一性，請重試後再儲存`);
      } else if (taken.has(key)) {
        issues.push(takenMessage.replace('{key}', key));
      }
    };
    if (showEntityKey)
      checkKey(
        'entityKey',
        data.entityKey,
        otherKeys.entityKeys,
        'entityKey「{key}」已被其他 gallery 使用'
      );
    if (showStoryKey)
      checkKey(
        '劇情點 key',
        data.storyKey,
        otherKeys.storyKeys,
        '劇情點 key「{key}」已被其他 gallery 使用'
      );
    return issues;
  }, [
    data.entityKey,
    data.storyKey,
    keyCheckStatus,
    otherKeys,
    showEntityKey,
    showStoryKey,
  ]);

  useEffect(() => {
    onValidationChange?.(validationIssues);
  }, [onValidationChange, validationIssues]);

  // 編輯器模式：普通圖片 / 精靈圖
  type EditorMode = 'image' | 'sprite';
  const [editorMode, setEditorMode] = useState<EditorMode>(
    data.images.some((img) => img.isSpriteSheet) ? 'sprite' : 'image'
  );

  // 精靈圖編輯器狀態
  const [spriteModalOpen, setSpriteModalOpen] = useState(false);
  const [spriteDeleteOpen, setSpriteDeleteOpen] = useState(false);
  const spriteItem = data.images.find((img) => img.isSpriteSheet) || undefined;

  // 圖片選擇器
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerItems, setPickerItems] = useState<ImagePickerItem[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  // 拖曳
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  // 刪除確認
  const [deleteConfirm, setDeleteConfirm] = useState<{
    imageId: string;
    file: string;
  } | null>(null);

  /**
   * 寫入的權威來源。
   *
   * 上傳／替換是非同步的，handler 裡的 `data` 是啟動當下的閉包快照；等 await
   * 回來時它可能已經過期，用它組 next 會把期間完成的另一筆寫入整個蓋掉（新增
   * 的圖片或替換的結果消失，已上傳的 R2 檔案變成孤兒，而使用者看到的是成功
   * 回饋）。所有寫入都改讀這個 ref，就不受 re-render 時序影響。
   *
   * ⚠️ 不可在 render 期間賦值（`dataRef.current = data`）——那會用尚未更新的
   * state 覆蓋掉 update 剛寫進去的新值。
   */
  const dataRef = useRef(data);

  const update = (patch: Partial<VisualsData>) => {
    const next = { ...dataRef.current, ...patch };
    dataRef.current = next;
    setData(next);
    onDataChange(next);
    onDirty();
  };

  const updateImage = (imageId: string, patch: Partial<ImageItem>) => {
    const nextImages = dataRef.current.images.map((img) =>
      img.id === imageId ? { ...img, ...patch } : img
    );
    update({ images: nextImages });
  };

  const removeImage = (imageId: string) => {
    update({
      images: dataRef.current.images
        .filter((img) => img.id !== imageId)
        .map((img, i) => ({ ...img, sortOrder: i })),
    });
  };

  /**
   * 素材操作互斥閘：新增、替換、媒體庫選取、模式切換共用一把鎖，同時只跑
   * 一條。光靠 dataRef 修好覆蓋問題還不夠——並行時使用者無從得知哪張圖在
   * 動，而模式切換會直接把 images 清空，進行中的上傳回來就沒有落點。
   *
   * 這個 state 供 UI 停用用；判斷一律走 assetBusyRef。
   */
  const assetBusy = uploading || replacingId !== null;

  /**
   * 閘的同步鏡像。
   *
   * state 要等 re-render 才看得到，同一個 tick 內的第二次觸發用它判斷會直接
   * 穿過去；`await` 之後讀閉包 state 也是舊值。所有 guard 判斷讀這個 ref，
   * 由發起操作的 handler 自己負責開關。
   */
  const assetBusyRef = useRef(false);

  // 上傳圖片
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    // UI 已停用，這是防守第二層（例如拖放或鍵盤觸發的意外並行）
    if (assetBusyRef.current) {
      e.target.value = '';
      return;
    }
    assetBusyRef.current = true;
    setUploading(true);
    setUploadProgress({ current: 1, total: files.length });
    try {
      const newImages: ImageItem[] = [];
      for (let i = 0; i < files.length; i++) {
        setUploadProgress({ current: i + 1, total: files.length });
        const result = await uploadAsset(files[i]);
        if (result) {
          newImages.push({
            id: generateId(),
            file: result.key,
            caption: '',
            sortOrder: dataRef.current.images.length + newImages.length,
          });
        }
      }
      if (newImages.length > 0) {
        update({ images: [...dataRef.current.images, ...newImages] });
      }
    } finally {
      assetBusyRef.current = false;
      setUploading(false);
      setUploadProgress({ current: 0, total: 0 });
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /**
   * 替換單張圖片：只改寫這一筆的 `file`，caption／排序／解鎖設定原封不動。
   *
   * 刻意不刪 R2 上的舊檔——同一個 key 可能被其他 gallery 或富文本引用，
   * 真要清掉走圖片列的刪除流程（那裡才有「僅移除引用 / 永久刪除」的選擇）。
   */
  const handleImageReplace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const targetId = replaceTargetId;
    if (!file || !targetId) return;
    if (assetBusyRef.current) {
      e.target.value = '';
      return;
    }
    assetBusyRef.current = true;
    setReplacingId(targetId);
    try {
      const result = await uploadAsset(file);
      if (result) updateImage(targetId, { file: result.key });
    } finally {
      assetBusyRef.current = false;
      setReplacingId(null);
      setReplaceTargetId(null);
      if (replaceInputRef.current) replaceInputRef.current.value = '';
    }
  };

  // 從媒體庫選擇；targetId 非空代表替換該筆而非新增
  const openImagePicker = async (targetId?: string) => {
    setReplaceTargetId(targetId ?? null);
    setPickerOpen(true);
    setPickerLoading(true);
    const items = await fetchImageAssets();
    setPickerItems(items);
    setPickerLoading(false);
  };

  const closeImagePicker = () => {
    setPickerOpen(false);
    setReplaceTargetId(null);
  };

  const selectFromLibrary = (item: ImagePickerItem) => {
    if (replaceTargetId) {
      updateImage(replaceTargetId, { file: item.key });
      closeImagePicker();
      return;
    }
    const already = dataRef.current.images.some((img) => img.file === item.key);
    if (already) return;
    const newImg: ImageItem = {
      id: generateId(),
      file: item.key,
      caption: '',
      sortOrder: dataRef.current.images.length,
    };
    update({ images: [...dataRef.current.images, newImg] });
    setPickerOpen(false);
  };

  // 刪除
  const handleRemoveOnly = () => {
    if (!deleteConfirm) return;
    removeImage(deleteConfirm.imageId);
    setDeleteConfirm(null);
  };

  const handleDeleteFromLibrary = async () => {
    if (!deleteConfirm) return;
    const file = deleteConfirm.file;
    removeImage(deleteConfirm.imageId);
    setDeleteConfirm(null);
    try {
      await deleteAsset(file);
    } catch (err) {
      console.error('刪除媒體庫檔案失敗:', err);
    }
  };

  // 拖曳排序
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDropIdx(idx);
  };
  const handleDrop = () => {
    if (dragIdx === null || dropIdx === null || dragIdx === dropIdx) {
      setDragIdx(null);
      setDropIdx(null);
      return;
    }
    const newImages = [...data.images];
    const [moved] = newImages.splice(dragIdx, 1);
    newImages.splice(dropIdx, 0, moved);
    update({
      images: newImages.map((img, i) => ({ ...img, sortOrder: i })),
    });
    setDragIdx(null);
    setDropIdx(null);
  };

  // 切換模式時清理資料
  const switchMode = async (mode: EditorMode) => {
    if (mode === editorMode) return;
    // 清空 images 會抽掉進行中上傳／替換的落點：新增回來會把普通圖片寫進
    // sprite 模式，替換則因為目標項目已消失而完全落空，兩者都留下孤兒 R2 檔案
    if (assetBusyRef.current) return;
    if (
      dataRef.current.images.length > 0 &&
      !(await getDialog().confirm(
        mode === 'sprite'
          ? '切換到精靈圖模式會清除目前的圖片，確定嗎？'
          : '切換到普通圖片模式會清除目前的精靈圖，確定嗎？'
      ))
    ) {
      return;
    }
    // 確認對話框是 await 的，這期間仍可能有操作啟動（例如拖放）
    if (assetBusyRef.current) return;
    update({ images: [], layout: mode === 'sprite' ? 'sprite' : '' });
    setEditorMode(mode);
  };

  // ── 精靈圖編輯器的內嵌 UI ──
  const renderSpriteEditor = () => (
    <div className="ned-subcat-section">
      <div className="ned-subcat-list-header">
        <label className="ned-field-label" style={{ margin: 0 }}>
          精靈圖
        </label>
        {spriteItem && (
          <span className="ned-subcat-list-count">
            {spriteItem.frameWidth}×{spriteItem.frameHeight} ·{' '}
            {spriteItem.frameCount} 幀 ·{' '}
            {Object.keys(spriteItem.animations || {}).length} 動畫
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button
            className="ned-btn-ghost ned-btn-sm"
            type="button"
            onClick={() => setSpriteModalOpen(true)}
            style={{ color: accent }}
          >
            {spriteItem ? '✎ 編輯精靈圖' : '+ 設定精靈圖'}
          </button>
          {spriteItem && (
            <button
              className="ned-btn-ghost ned-btn-sm"
              type="button"
              onClick={() => setSpriteDeleteOpen(true)}
              style={{ color: '#c44' }}
            >
              ✕ 移除
            </button>
          )}
        </div>
      </div>

      {!spriteItem ? (
        <div className="ned-subcat-empty">
          尚未設定精靈圖 — 點擊上方按鈕開始設定
        </div>
      ) : (
        <div style={{ padding: '12px 0' }}>
          {/* 精靈圖預覽 */}
          <div
            style={{
              display: 'flex',
              gap: 16,
              alignItems: 'flex-start',
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                width: 120,
                height: 120,
                flexShrink: 0,
                overflow: 'hidden',
                border: '1px solid var(--line, #333)',
                borderRadius: 4,
                background: 'var(--bg-elevated, #252530)',
                imageRendering: 'pixelated',
              }}
            >
              <img
                src={buildImageUrl(spriteItem.file)}
                alt="sprite sheet"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  imageRendering: 'pixelated',
                }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, marginBottom: 6, fontWeight: 600 }}>
                {spriteItem.file.split('/').pop()}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--ink-mute)',
                  lineHeight: 1.8,
                }}
              >
                <div>
                  幀尺寸: {spriteItem.frameWidth}×{spriteItem.frameHeight}px
                </div>
                <div>
                  格局: {spriteItem.columns}×{spriteItem.rows} (
                  {spriteItem.frameCount} 幀)
                </div>
                <div>播放速率: {spriteItem.fps} fps</div>
                <div>基準像素: {spriteItem.basePixelSize}×</div>
                <div>
                  動畫數: {Object.keys(spriteItem.animations || {}).length}
                </div>
                {Object.entries(spriteItem.animations || {}).map(
                  ([name, [s, e]]) => (
                    <div key={name} style={{ paddingLeft: 12 }}>
                      ├ {name}: 幀 {s}–{e}
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SpriteEditorModal */}
      {spriteModalOpen && (
        <SpriteEditorModal
          existing={spriteItem}
          onConfirm={(item) => {
            update({ images: [item], layout: 'sprite' });
            setSpriteModalOpen(false);
          }}
          onClose={() => setSpriteModalOpen(false)}
        />
      )}

      {/* 精靈圖刪除確認 */}
      {spriteDeleteOpen && spriteItem && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setSpriteDeleteOpen(false)}
        >
          <div
            style={{
              background: 'var(--bg-card, #1a1a22)',
              border: '1px solid var(--line, #333)',
              borderRadius: 12,
              padding: '24px 28px',
              maxWidth: 400,
              width: '90%',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{ fontWeight: 600, marginBottom: 8, fontSize: '1.05em' }}
            >
              移除精靈圖
            </div>
            <div
              style={{
                fontSize: '0.85em',
                color: 'var(--ink-mute, #888)',
                marginBottom: 16,
                wordBreak: 'break-all',
              }}
            >
              {spriteItem.file.split('/').pop()}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                type="button"
                className="ned-btn-ghost"
                onClick={() => {
                  update({ images: [], layout: '' });
                  setSpriteDeleteOpen(false);
                }}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  textAlign: 'left',
                }}
              >
                📎 僅從此畫廊移除
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
                onClick={async () => {
                  const file = spriteItem.file;
                  update({ images: [], layout: '' });
                  setSpriteDeleteOpen(false);
                  try {
                    await deleteAsset(file);
                  } catch (err) {
                    console.error('刪除媒體庫檔案失敗:', err);
                  }
                }}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  textAlign: 'left',
                  borderColor: 'crimson',
                  color: 'crimson',
                }}
              >
                🗑 從媒體庫永久刪除
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
                onClick={() => setSpriteDeleteOpen(false)}
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
    </div>
  );

  return (
    <div className="ned-echoes-body">
      {/* 編輯器模式切換 */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          marginBottom: 16,
          borderBottom: '1px solid var(--line, #333)',
        }}
      >
        {(['image', 'sprite'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => switchMode(mode)}
            disabled={assetBusy && editorMode !== mode}
            title={
              assetBusy && editorMode !== mode
                ? '素材處理中，完成後才能切換模式'
                : undefined
            }
            style={{
              padding: '8px 20px',
              border: 'none',
              borderBottom:
                editorMode === mode
                  ? `2px solid ${accent}`
                  : '2px solid transparent',
              background: 'transparent',
              color: editorMode === mode ? accent : 'var(--ink-mute)',
              fontWeight: editorMode === mode ? 600 : 400,
              fontSize: 13,
              cursor: assetBusy && editorMode !== mode ? 'default' : 'pointer',
              opacity: assetBusy && editorMode !== mode ? 0.5 : 1,
              transition: 'all 0.15s',
            }}
          >
            {mode === 'image' ? '普通圖片' : '精靈圖'}
          </button>
        ))}
      </div>

      {editorMode === 'sprite' ? (
        renderSpriteEditor()
      ) : (
        /* 圖片清單 */
        <div className="ned-subcat-section">
          <div className="ned-subcat-list-header">
            <label className="ned-field-label" style={{ margin: 0 }}>
              圖片清單
            </label>
            <span className="ned-subcat-list-count">
              {data.images.length} 張
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button
                className="ned-btn-ghost ned-btn-sm"
                type="button"
                onClick={() => openImagePicker()}
                disabled={assetBusy}
                style={{ color: accent }}
              >
                📂 媒體庫
              </button>
              <button
                className="ned-btn-ghost ned-btn-sm"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={assetBusy}
                aria-busy={uploading}
                style={{ color: accent }}
              >
                {uploading ? (
                  <UploadSpinner
                    label="上傳中"
                    current={uploadProgress.current}
                    total={uploadProgress.total}
                  />
                ) : (
                  '+ 上傳圖片'
                )}
              </button>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={handleImageUpload}
          />

          <input
            ref={replaceInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleImageReplace}
          />

          {data.images.length === 0 && (
            <div className="ned-subcat-empty">
              尚無圖片 — 上傳或從媒體庫選取
            </div>
          )}

          <div className="ned-subcat-song-list">
            {data.images.map((img, i) => {
              const isExpanded = expandedId === img.id;
              const isDragging = dragIdx === i;
              const isDropTarget = dropIdx === i;

              return (
                <div key={img.id}>
                  <div
                    className={`ned-subcat-song-row ${isDragging ? 'is-dragging' : ''} ${isDropTarget ? 'is-drop-target' : ''}`}
                    draggable
                    onDragStart={() => handleDragStart(i)}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDrop={handleDrop}
                    onDragEnd={() => {
                      setDragIdx(null);
                      setDropIdx(null);
                    }}
                  >
                    <span className="ned-subcat-song-grip" title="拖曳排序">
                      ⠿
                    </span>
                    <span
                      className="ned-subcat-song-num"
                      style={{ color: accent }}
                    >
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {/* 縮圖 */}
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        flexShrink: 0,
                        overflow: 'hidden',
                        border: '1px solid var(--line, #333)',
                        borderRadius: 4,
                        background: 'var(--bg-elevated, #252530)',
                      }}
                    >
                      {img.file && (
                        <img
                          src={buildImageUrl(img.file)}
                          alt=""
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                          }}
                        />
                      )}
                    </div>
                    <div className="ned-subcat-song-info" style={{ flex: 1 }}>
                      <span
                        className="ned-subcat-song-title"
                        style={{ cursor: 'pointer' }}
                        onClick={() =>
                          setExpandedId(isExpanded ? null : img.id)
                        }
                      >
                        {img.file?.split('/').pop() || '(未上傳)'}
                      </span>
                      {img.caption && (
                        <span className="ned-subcat-song-sub">
                          {img.caption}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="ned-subcat-song-edit"
                      style={{ color: accent }}
                      title={isExpanded ? '收合' : '展開編輯'}
                      onClick={() => setExpandedId(isExpanded ? null : img.id)}
                    >
                      {isExpanded ? '▾' : '▸'}
                    </button>
                    <button
                      type="button"
                      className="ned-subcat-song-delete"
                      onClick={() =>
                        setDeleteConfirm({
                          imageId: img.id,
                          file: img.file,
                        })
                      }
                      title="刪除圖片"
                    >
                      ×
                    </button>
                  </div>

                  {/* 展開的編輯區 */}
                  {isExpanded && (
                    <div
                      style={{
                        padding: '12px 16px 12px 60px',
                        borderBottom: '1px solid var(--line, #333)',
                        background: 'var(--bg-soft, #1a1a22)',
                      }}
                    >
                      {/* 圖片預覽 */}
                      {img.file && (
                        <div
                          style={{
                            marginBottom: 12,
                            maxWidth: 320,
                            border: '1px solid var(--line, #333)',
                            borderRadius: 4,
                            overflow: 'hidden',
                          }}
                        >
                          <img
                            src={buildImageUrl(img.file)}
                            alt={img.caption || ''}
                            style={{
                              width: '100%',
                              display: 'block',
                            }}
                          />
                        </div>
                      )}

                      {/* 替換圖檔：只換 file，caption 與解鎖設定留著 */}
                      <div
                        style={{
                          display: 'flex',
                          gap: 6,
                          marginBottom: 12,
                        }}
                      >
                        <button
                          className="ned-btn-ghost ned-btn-sm"
                          type="button"
                          onClick={() => {
                            setReplaceTargetId(img.id);
                            replaceInputRef.current?.click();
                          }}
                          disabled={assetBusy}
                          aria-busy={replacingId === img.id}
                          style={{ color: accent }}
                          title="上傳新檔案取代這張圖"
                        >
                          {replacingId === img.id ? (
                            <UploadSpinner label="上傳中" />
                          ) : (
                            '⟳ 替換圖片'
                          )}
                        </button>
                        <button
                          className="ned-btn-ghost ned-btn-sm"
                          type="button"
                          onClick={() => openImagePicker(img.id)}
                          disabled={assetBusy}
                          style={{ color: accent }}
                          title="從媒體庫挑一張取代這張圖"
                        >
                          📂 從媒體庫替換
                        </button>
                      </div>

                      <label className="ned-field-label ned-field-label--sm">
                        說明 (Caption)
                      </label>
                      <input
                        className="ned-field ned-field--sm"
                        type="text"
                        value={img.caption}
                        placeholder="圖片說明..."
                        onChange={(e) =>
                          updateImage(img.id, {
                            caption: e.target.value,
                          })
                        }
                      />

                      {/* 三態解鎖（S8 下半場 V-B.17）。
                          第一張圖恆等式：欄位鎖定；重排時約束跟著新的
                          第一張走，原第一張的既有資料保留但不生效
                          （resolver 只認 index 0）。 */}
                      {i === 0 ? (
                        <div
                          className="ned-gate-scope-hint"
                          style={{ marginTop: 10 }}
                        >
                          ⓘ 第一張圖恆等於 gallery
                          解鎖狀態，不設自身條件；重排圖片後此約束跟隨新的第一張。
                          {(img.initialState === 'locked' ||
                            img.initialState === 'partial' ||
                            normalizeGateObject(img.lockGate) ||
                            normalizeGateObject(img.partialGate)) &&
                            ' 此圖先前設定的三態資料保留但不生效。'}
                        </div>
                      ) : (
                        (() => {
                          const effectiveInitial: ImageDisplayState =
                            img.initialState === 'locked' ||
                            img.initialState === 'partial'
                              ? img.initialState
                              : 'unlocked';
                          const chain = describeImageChain(
                            effectiveInitial,
                            !!normalizeGateObject(img.lockGate),
                            !!normalizeGateObject(img.partialGate)
                          );
                          return (
                            <div style={{ marginTop: 12 }}>
                              <label className="ned-field-label ned-field-label--sm">
                                初始狀態 (三態解鎖)
                              </label>
                              <div className="ned-spoiler-buttons">
                                {IMAGE_STATE_OPTIONS.map((o) => {
                                  const active = effectiveInitial === o.value;
                                  return (
                                    <button
                                      key={o.value}
                                      type="button"
                                      className={`ned-spoiler-btn ${active ? 'is-active' : ''}`}
                                      style={{
                                        borderColor: active
                                          ? accent
                                          : 'var(--hairline-strong)',
                                        background: active
                                          ? `${accent}12`
                                          : 'transparent',
                                        color: active
                                          ? accent
                                          : 'var(--ink-soft)',
                                      }}
                                      onClick={() =>
                                        updateImage(img.id, {
                                          // C（解鎖）＝預設語意，省略欄位保持
                                          // metadata 精簡
                                          initialState:
                                            o.value === 'unlocked'
                                              ? undefined
                                              : o.value,
                                        })
                                      }
                                    >
                                      {o.code}
                                      <span className="ned-spoiler-btn-label">
                                        {o.label}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                              <div
                                className="ned-gate-scope-hint"
                                style={
                                  chain.warn
                                    ? { color: 'goldenrod' }
                                    : undefined
                                }
                              >
                                {chain.warn ? '⚠' : 'ⓘ'} {chain.text}
                              </div>
                              {effectiveInitial !== 'unlocked' && (
                                <>
                                  <label className="ned-field-label ned-field-label--sm">
                                    鎖定條件（離開 A 的閘）
                                  </label>
                                  <GateConditionEditor
                                    value={normalizeGateObject(img.lockGate)}
                                    onChange={(next) =>
                                      updateImage(img.id, { lockGate: next })
                                    }
                                    apiBase={apiBase}
                                    accent={accent}
                                    showScopeHint={false}
                                  />
                                  <label className="ned-field-label ned-field-label--sm">
                                    部分條件（離開 B 的閘）
                                  </label>
                                  <GateConditionEditor
                                    value={normalizeGateObject(img.partialGate)}
                                    onChange={(next) =>
                                      updateImage(img.id, { partialGate: next })
                                    }
                                    apiBase={apiBase}
                                    accent={accent}
                                    showScopeHint={false}
                                  />
                                </>
                              )}
                            </div>
                          );
                        })()
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 分組標籤 */}
      <label className="ned-field-label">分組標籤</label>
      <input
        className="ned-field"
        type="text"
        value={data.group}
        placeholder="例如：主要角色、U時期"
        onChange={(e) => update({ group: e.target.value })}
      />

      {/* 解鎖提示文案——鎖定 gallery 的封印面板顯示的劇情提示，不參與
          求值。解鎖條件本身由右側 Inspector 的 PROGRESS GATE 面板管理。 */}
      <label className="ned-field-label">解鎖提示文案</label>
      <input
        className="ned-field"
        type="text"
        value={data.gateHint}
        placeholder="例如：讀完第三章後再觀看"
        onChange={(e) => update({ gateHint: e.target.value })}
      />
      <div className="ned-gate-scope-hint">
        ⓘ 顯示在未解鎖 gallery 的封印面板上；gallery 的解鎖條件請在右側 PROGRESS
        GATE 面板設定。
      </div>

      {/* 跨 zone 識別欄位：entityKey（陳列走廊）/ 劇情點 key（鑲框室），
          依分館顯隱（S8 下半場 §1-1），同 zone 唯一 */}
      {(showEntityKey || showStoryKey) && (
        <div className="ned-echoes-entity-section">
          {showEntityKey && (
            <>
              <EntityKeyField
                value={data.entityKey || undefined}
                existingKeys={otherKeys.entityKeys}
                onChange={(entityKey) => update({ entityKey: entityKey || '' })}
                duplicateMessage="此實體ID 已被其他 gallery 使用"
              />
              <div className="ned-gate-scope-hint">
                實體ID 用於角色／區域嵌入反查設定圖 gallery（浮動幻影提示
                卡）；未綁定的 gallery 不參與嵌入反查。
              </div>
            </>
          )}
          {showStoryKey && (
            <>
              <EntityKeyField
                value={data.storyKey || undefined}
                existingKeys={otherKeys.storyKeys}
                onChange={(storyKey) => update({ storyKey: storyKey || '' })}
                label="劇情點ID"
                placeholder="如 rain-sea-finale（選填）"
                duplicateMessage="此劇情點ID 已被其他 gallery 使用"
              />
              <div className="ned-gate-scope-hint">
                劇情點 key 供 History 文中的 Visual Clue 引用此 gallery；未設定
                即無法被 clue 指向。同一個 key 也可以掛在 Echoes
                的劇情歌上——歌與插圖會被視為同一個劇情點的兩面。
              </div>
            </>
          )}
          {(data.entityKey || data.storyKey) && keyCheckStatus === 'error' && (
            <button
              type="button"
              className="ned-btn-ghost ned-btn-sm"
              onClick={() => setKeyCheckReload((value) => value + 1)}
            >
              重試唯一性查核
            </button>
          )}
        </div>
      )}

      {validationIssues.length > 0 && (
        <div className="ned-echoes-validation" role="alert">
          {validationIssues.map((issue) => (
            <div key={issue}>⚠ {issue}</div>
          ))}
        </div>
      )}

      {/* 展示風格 */}
      <label className="ned-field-label">展示風格 (Layout)</label>
      <select
        className="ned-field"
        value={data.layout}
        onChange={(e) => update({ layout: e.target.value })}
        style={{ color: data.layout ? accent : 'var(--ink-mute)' }}
      >
        {LAYOUT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {/* 刪除確認 Dialog */}
      {deleteConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            style={{
              background: 'var(--bg-card, #1a1a22)',
              border: '1px solid var(--line, #333)',
              borderRadius: 12,
              padding: '24px 28px',
              maxWidth: 400,
              width: '90%',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                fontWeight: 600,
                marginBottom: 8,
                fontSize: '1.05em',
              }}
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
              {deleteConfirm.file.split('/').pop()}
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <button
                type="button"
                className="ned-btn-ghost"
                onClick={handleRemoveOnly}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  textAlign: 'left',
                }}
              >
                📎 僅從此畫廊移除
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
                onClick={() => void handleDeleteFromLibrary()}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  textAlign: 'left',
                  borderColor: 'crimson',
                  color: 'crimson',
                }}
              >
                🗑 從媒體庫永久刪除
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
                onClick={() => setDeleteConfirm(null)}
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

      {/* 圖片選擇器 Modal */}
      {pickerOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={closeImagePicker}
        >
          <div
            style={{
              background: 'var(--bg-card, #1a1a22)',
              border: '1px solid var(--line, #333)',
              borderRadius: 12,
              width: '90%',
              maxWidth: 640,
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--line, #333)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <strong>
                  {replaceTargetId ? '從媒體庫替換圖片' : '從媒體庫選擇圖片'}
                </strong>
                <span
                  style={{
                    marginLeft: 10,
                    fontSize: '0.85em',
                    color: 'var(--ink-mute, #888)',
                  }}
                >
                  僅顯示圖片 · 孤兒檔案優先
                </span>
              </div>
              <button
                type="button"
                onClick={closeImagePicker}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ink, #ccc)',
                  fontSize: 20,
                  cursor: 'pointer',
                  padding: '0 4px',
                }}
              >
                ×
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
              {pickerLoading ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: 32,
                    color: 'var(--ink-mute, #888)',
                  }}
                >
                  載入中...
                </div>
              ) : pickerItems.length === 0 ? (
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
                  {pickerItems.map((item) => {
                    // 替換模式下，被替換的那一筆自己不算佔用（否則整格灰掉無從點選）
                    const already = data.images.some(
                      (img) =>
                        img.file === item.key && img.id !== replaceTargetId
                    );
                    return (
                      <button
                        key={item.key}
                        type="button"
                        disabled={already || assetBusy}
                        onClick={() => selectFromLibrary(item)}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          border: `1px solid ${already ? accent : 'var(--line, #333)'}`,
                          background: already ? `${accent}15` : 'transparent',
                          borderRadius: 6,
                          overflow: 'hidden',
                          cursor: already ? 'default' : 'pointer',
                          opacity: already ? 0.5 : 1,
                          padding: 0,
                          color: 'var(--ink, #ccc)',
                        }}
                      >
                        <img
                          src={buildImageUrl(item.key)}
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
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
