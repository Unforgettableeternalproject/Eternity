/* global AbortController */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  revisionSourceLevel,
  type SongSpoilerRevision,
  type SpoilerLevel,
} from '../../audio';
import { isSamePagePath } from '../../lib/pagePath';
import type { GateCondition } from '../../progress';
import { API_BASE, uploadAsset, deleteAsset } from './editorHelpers';
import { deriveSongCategoryFromPageId } from './echoesCategory';
import EntityKeyField, { ENTITY_KEY_PATTERN } from './EntityKeyField';
import GateConditionEditor from './GateConditionEditor';
import { UploadSpinner } from './UploadSpinner';

interface EchoesEditorBodyProps {
  accent: string;
  initialData: EchoesData;
  apiBase: string;
  songId: string;
  onDataChange: (data: EchoesData) => void;
  onDirty: () => void;
  onValidationChange?: (issues: string[]) => void;
}

export interface AudioMeta {
  size?: number;
  duration?: number;
  info?: string;
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  genre?: string;
  bitrate?: number;
  format?: string;
}

interface EchoesTreeNodeForEntityKey {
  id: string;
  pageType?: string;
  metadata?: { entityKey?: unknown; storyKey?: unknown };
  children?: EchoesTreeNodeForEntityKey[];
}

/**
 * 收集同 zone 其他歌曲已使用的 key（兩種命名空間各一份）；
 * page id 比較須容忍 encoded/decoded 差異。
 */
export function collectOtherEchoesEntityKeys(
  nodes: EchoesTreeNodeForEntityKey[],
  songId: string
): { entityKeys: Set<string>; storyKeys: Set<string> } {
  const entityKeys = new Set<string>();
  const storyKeys = new Set<string>();
  const walk = (items: EchoesTreeNodeForEntityKey[]) => {
    for (const node of items) {
      if (node.pageType === 'song' && !isSamePagePath(node.id, songId)) {
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

export interface EchoesData {
  subtitle: string;
  /**
   * 分類。唯一來源是所在 cluster（見 `echoesCategory.ts`），編輯器唯讀，
   * metadata 裡的值只是推導結果的鏡像。
   */
  category: string;
  spoilerLevel: number;
  /** spoiler 警告視窗顯示的劇情提示；不可再與 metadata.gate 混用。 */
  spoilerGate: string;
  entityKey?: string;
  /** 劇情歌的劇情點身分（選填）；與 entityKey 依 category 互斥使用 */
  storyKey?: string;
  spoilerRevisions: SongSpoilerRevision[];
  audioFile: string | null;
  audioMeta: AudioMeta | null;
  coverImage: string | null;
  appreciation: string[];
  appreciationLocked: string;
}

export function parseEchoesData(
  metadata: Record<string, any>,
  /** 歌曲頁 id——有給就依 cluster 推導分類，忽略 metadata 裡可能過期的值 */
  songId?: string
): EchoesData {
  // 舊資料曾把提示文案存在 metadata.gate 字串；GateCondition 物件則留給
  // 全站內容可見性，不可當文案讀取。
  const legacySpoilerGate =
    typeof metadata?.gate === 'string' ? metadata.gate : '';
  // cluster 是分類的唯一來源；沒給 songId（測試/舊呼叫）才退回 metadata
  const category = songId
    ? deriveSongCategoryFromPageId(songId)
    : metadata?.category || 'character';
  const spoilerRevisions: SongSpoilerRevision[] = Array.isArray(
    metadata?.spoilerRevisions
  )
    ? metadata.spoilerRevisions
        .map((revision: unknown): SongSpoilerRevision | null => {
          if (!revision || typeof revision !== 'object') return null;
          const candidate = revision as SongSpoilerRevision;
          const sourceLevel = revisionSourceLevel(candidate);
          return sourceLevel &&
            candidate.gate &&
            typeof candidate.gate === 'object'
            ? { sourceLevel, gate: candidate.gate }
            : null;
        })
        .filter(
          (
            revision: SongSpoilerRevision | null
          ): revision is SongSpoilerRevision => revision !== null
        )
    : [];
  const highestConfigured = spoilerRevisions.reduce<number>(
    (highest, revision) =>
      Math.max(highest, revisionSourceLevel(revision) || 0),
    0
  );
  return {
    subtitle: metadata?.subtitle || '',
    category,
    spoilerLevel: category === 'story' ? 0 : highestConfigured || 0,
    spoilerGate: metadata?.spoilerGate || legacySpoilerGate,
    entityKey:
      typeof metadata?.entityKey === 'string' && metadata.entityKey.trim()
        ? metadata.entityKey.trim()
        : undefined,
    storyKey:
      typeof metadata?.storyKey === 'string' && metadata.storyKey.trim()
        ? metadata.storyKey.trim()
        : undefined,
    spoilerRevisions: category === 'story' ? [] : spoilerRevisions,
    audioFile: metadata?.audioFile || null,
    audioMeta: metadata?.audioMeta || null,
    coverImage: metadata?.coverImage || null,
    appreciation: metadata?.appreciation || [''],
    appreciationLocked: metadata?.appreciationLocked || '',
  };
}

export function serializeEchoesData(data: EchoesData): Record<string, any> {
  const isStory = data.category === 'story';
  const highestConfigured = data.spoilerRevisions.reduce<number>(
    (highest, revision) =>
      Math.max(highest, revisionSourceLevel(revision) || 0),
    0
  );
  return {
    subtitle: data.subtitle || undefined,
    category: data.category,
    spoilerLevel: isStory ? 0 : highestConfigured,
    ...(!isStory && data.spoilerGate ? { spoilerGate: data.spoilerGate } : {}),
    // 兩種 key 依分類互斥輸出——分類改變時舊那個要跟著卸下，
    // 否則會留下永遠不被讀取卻仍佔用命名空間的殘值
    entityKey: isStory ? undefined : data.entityKey || undefined,
    storyKey: isStory ? data.storyKey || undefined : undefined,
    ...(!isStory && data.spoilerRevisions.length > 0
      ? { spoilerRevisions: data.spoilerRevisions }
      : {}),
    audioFile: data.audioFile || undefined,
    audioMeta: data.audioMeta || undefined,
    coverImage: data.coverImage || undefined,
    appreciation: data.appreciation.filter((p) => p.trim()),
    appreciationLocked: data.appreciationLocked || undefined,
  };
}

/** 用 HTMLAudioElement 讀取 duration */
function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration || 0);
    });
    audio.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      resolve(0);
    });
    audio.src = url;
  });
}

// ──────────────────────────────────────────────────────────────
// 輕量 ID3v2 解析器（純瀏覽器端，零依賴）
// 支援 ID3v2.3 / v2.4 的 text frames (TIT2, TPE1, TALB, TDRC/TYER, TCON)
// ──────────────────────────────────────────────────────────────

/** 從 DataView 讀取 ID3v2 synchsafe integer（4 bytes, 每 byte 只用 7 bits）*/
function readSynchsafe(dv: DataView, offset: number): number {
  return (
    ((dv.getUint8(offset) & 0x7f) << 21) |
    ((dv.getUint8(offset + 1) & 0x7f) << 14) |
    ((dv.getUint8(offset + 2) & 0x7f) << 7) |
    (dv.getUint8(offset + 3) & 0x7f)
  );
}

/** 解碼 ID3v2 文字 frame 的內容 */
function decodeTextFrame(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  const encoding = bytes[0];
  const data = bytes.slice(1);

  if (encoding === 0) {
    // ISO-8859-1
    return Array.from(data)
      .map((b) => String.fromCharCode(b))
      .join('')
      .replace(/\0+$/, '');
  }
  if (encoding === 1 || encoding === 2) {
    // UTF-16 (LE/BE with or without BOM)
    const isLE =
      encoding === 2
        ? false
        : data.length >= 2 && data[0] === 0xff && data[1] === 0xfe;
    const start =
      data.length >= 2 && (data[0] === 0xff || data[0] === 0xfe) ? 2 : 0;
    const arr: number[] = [];
    for (let i = start; i + 1 < data.length; i += 2) {
      const code = isLE
        ? data[i] | (data[i + 1] << 8)
        : (data[i] << 8) | data[i + 1];
      if (code === 0) break;
      arr.push(code);
    }
    return String.fromCharCode(...arr);
  }
  if (encoding === 3) {
    // UTF-8
    return new TextDecoder('utf-8').decode(data).replace(/\0+$/, '');
  }
  return '';
}

/** 解析 ID3v2 tags（讀取檔案前 128KB 即可） */
async function readId3Tags(
  file: File
): Promise<
  Partial<Pick<AudioMeta, 'title' | 'artist' | 'album' | 'year' | 'genre'>>
> {
  try {
    // 只讀取前 128KB（ID3 header 通常遠小於這個大小）
    const slice = file.slice(0, 131072);
    const buf = await slice.arrayBuffer();
    const dv = new DataView(buf);
    const bytes = new Uint8Array(buf);

    // 檢查 ID3v2 header: "ID3"
    if (
      bytes[0] !== 0x49 || // I
      bytes[1] !== 0x44 || // D
      bytes[2] !== 0x33 // 3
    ) {
      return {};
    }

    const majorVersion = bytes[3]; // 3 or 4
    const tagSize = readSynchsafe(dv, 6);
    const useSynchsafe = majorVersion >= 4;

    const result: Partial<
      Pick<AudioMeta, 'title' | 'artist' | 'album' | 'year' | 'genre'>
    > = {};
    const frameIdMap: Record<string, keyof typeof result> = {
      TIT2: 'title',
      TPE1: 'artist',
      TALB: 'album',
      TYER: 'year',
      TDRC: 'year',
      TCON: 'genre',
    };

    let pos = 10; // header 後開始
    const end = Math.min(10 + tagSize, buf.byteLength);

    while (pos + 10 <= end) {
      const frameId = String.fromCharCode(
        bytes[pos],
        bytes[pos + 1],
        bytes[pos + 2],
        bytes[pos + 3]
      );

      // 遇到 padding (0x00) 或無效 frame 就停止
      if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

      const frameSize = useSynchsafe
        ? readSynchsafe(dv, pos + 4)
        : dv.getUint32(pos + 4);

      // 安全檢查
      if (frameSize <= 0 || pos + 10 + frameSize > end) break;

      const field = frameIdMap[frameId];
      if (field) {
        const content = decodeTextFrame(
          bytes.slice(pos + 10, pos + 10 + frameSize)
        );
        if (content) {
          result[field] = content;
        }
      }

      pos += 10 + frameSize;
    }

    return result;
  } catch {
    return {};
  }
}

/** 從瀏覽器讀取音檔 metadata（duration + ID3 tags）*/
async function readAudioMeta(file: File): Promise<Partial<AudioMeta>> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const [duration, id3] = await Promise.all([
    readAudioDuration(file),
    readId3Tags(file),
  ]);
  const bitrate =
    duration > 0 ? Math.round((file.size * 8) / duration / 1000) : undefined;
  return {
    size: file.size,
    duration: Math.round(duration * 100) / 100,
    bitrate,
    format: ext,
    ...id3,
  };
}

// uploadAsset, deleteAsset 已移至 editorHelpers.ts

/** 格式化時長 */
function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const SPOILER_LEVELS = [
  { l: 0, n: '無' },
  { l: 1, n: '霧化' },
  { l: 2, n: '遮罩' },
  { l: 3, n: '雜訊' },
];

const CATEGORIES = [
  { value: 'area', label: '場景主題曲' },
  { value: 'character', label: '角色主題曲' },
  { value: 'story', label: '劇情歌' },
  { value: 'special', label: '特殊曲目' },
];

// === 音檔選擇器（從媒體庫選取既有音檔）===
interface AudioPickerItem {
  key: string;
  size: number;
  contentType: string;
  originalName: string;
  referenced: boolean;
  referencedBy: string[];
}

/** 從 content-api 取得音檔列表（僅音檔，孤兒排前面）*/
async function fetchAudioAssets(): Promise<AudioPickerItem[]> {
  try {
    const res = await fetch(`/api/assets?prefix=audio/&limit=500`);
    if (!res.ok) return [];
    const json = (await res.json()) as {
      ok: boolean;
      data: { items: AudioPickerItem[] };
    };
    if (!json.ok) return [];
    const items = json.data.items.filter(
      (i) => i.contentType?.startsWith('audio/') || i.key.startsWith('audio/')
    );
    // 孤兒排前面
    items.sort((a, b) => {
      if (a.referenced === b.referenced) return 0;
      return a.referenced ? 1 : -1;
    });
    return items;
  } catch {
    return [];
  }
}

/** 從音檔 URL 讀取 duration（透過 HTMLAudioElement）*/
function readDurationFromUrl(url: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => {
      resolve(audio.duration || 0);
      audio.src = '';
    });
    audio.addEventListener('error', () => {
      resolve(0);
      audio.src = '';
    });
    audio.src = url;
  });
}

export default function EchoesEditorBody({
  accent,
  initialData,
  apiBase,
  songId,
  onDataChange,
  onDirty,
  onValidationChange,
}: EchoesEditorBodyProps) {
  const [data, setData] = useState<EchoesData>(initialData);
  const [selectedSpoilerLevel, setSelectedSpoilerLevel] =
    useState<SpoilerLevel | null>(null);
  const [uploading, setUploading] = useState<'audio' | 'cover' | null>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // === 音檔選擇器 state ===
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerItems, setPickerItems] = useState<AudioPickerItem[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerSelecting, setPickerSelecting] = useState<string | null>(null);
  const [otherEntityKeys, setOtherEntityKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [otherStoryKeys, setOtherStoryKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [entityKeyCheckStatus, setEntityKeyCheckStatus] = useState<
    'loading' | 'ready' | 'error'
  >('loading');
  const [entityKeyReload, setEntityKeyReload] = useState(0);

  // === 刪除確認 state ===
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: 'audio' | 'cover';
    key: string;
  } | null>(null);

  const update = (patch: Partial<EchoesData>) => {
    const next = { ...data, ...patch };
    setData(next);
    onDataChange(next);
    onDirty();
  };

  /** 兩種 key 在 Echoes zone 都以歌曲頁為唯一範圍；查核未完成時不可存檔。 */
  useEffect(() => {
    const controller = new AbortController();
    setEntityKeyCheckStatus('loading');
    fetch(`${apiBase}/api/content/echoes/tree`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (!payload?.ok || !Array.isArray(payload.data)) {
          throw new Error('Echoes tree payload 格式錯誤');
        }
        const keys = collectOtherEchoesEntityKeys(payload.data, songId);
        setOtherEntityKeys(keys.entityKeys);
        setOtherStoryKeys(keys.storyKeys);
        setEntityKeyCheckStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setEntityKeyCheckStatus('error');
      });
    return () => controller.abort();
  }, [apiBase, entityKeyReload, songId]);

  const validationIssues = useMemo(() => {
    const issues: string[] = [];
    // 依分類只驗當下生效的那一個 key——storyKey 是選填，沒填不算問題，
    // 只是該歌無法互聯也無法被收藏（提示文案已在欄位旁說明）
    const isStory = data.category === 'story';
    const activeKey = isStory ? data.storyKey : data.entityKey;
    const label = isStory ? '劇情點 key' : 'entityKey';
    const taken = isStory ? otherStoryKeys : otherEntityKeys;
    if (activeKey && !ENTITY_KEY_PATTERN.test(activeKey)) {
      issues.push(`${label}「${activeKey}」不是合法 kebab-case`);
    } else if (activeKey && entityKeyCheckStatus === 'loading') {
      issues.push(`正在查核${label}唯一性，請稍候`);
    } else if (activeKey && entityKeyCheckStatus === 'error') {
      issues.push(`無法查核${label}唯一性，請重試後再儲存`);
    } else if (activeKey && taken.has(activeKey)) {
      issues.push(`${label}「${activeKey}」已被其他歌曲使用`);
    }
    const levels = data.spoilerRevisions
      .map(revisionSourceLevel)
      .filter((level): level is 1 | 2 | 3 => level !== null);
    if (new Set(levels).size !== levels.length) {
      issues.push('同一個 Spoiler Level 不可設定多組離開條件');
    }
    return issues;
  }, [
    data.category,
    data.entityKey,
    data.storyKey,
    data.spoilerRevisions,
    entityKeyCheckStatus,
    otherEntityKeys,
    otherStoryKeys,
  ]);

  useEffect(() => {
    onValidationChange?.(validationIssues);
  }, [onValidationChange, validationIssues]);

  const gateForLevel = (level: 1 | 2 | 3): GateCondition | null =>
    data.spoilerRevisions.find(
      (revision) => revisionSourceLevel(revision) === level
    )?.gate ?? null;

  const setSpoilerGate = (level: 1 | 2 | 3, nextGate: GateCondition | null) => {
    const ordered: Array<3 | 2 | 1> = [3, 2, 1];
    const byLevel = new Map(
      data.spoilerRevisions
        .map((revision) => [revisionSourceLevel(revision), revision] as const)
        .filter(
          (entry): entry is readonly [1 | 2 | 3, SongSpoilerRevision] =>
            entry[0] !== null
        )
    );
    if (nextGate) {
      byLevel.set(level, { sourceLevel: level, gate: nextGate });
    } else {
      byLevel.delete(level);
    }
    const revisions = ordered
      .map((sourceLevel) => byLevel.get(sourceLevel))
      .filter((revision): revision is SongSpoilerRevision => !!revision);
    const highest = revisions[0] ? revisionSourceLevel(revisions[0]) : null;
    update({
      spoilerLevel: highest ?? 0,
      spoilerRevisions: revisions,
    });
  };

  const selectSpoilerLevel = (level: SpoilerLevel) => {
    setSelectedSpoilerLevel(level);
  };

  const updateAudioMeta = (patch: Partial<AudioMeta>) => {
    update({ audioMeta: { ...data.audioMeta, ...patch } });
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading('audio');
    try {
      const [result, meta] = await Promise.all([
        uploadAsset(file),
        readAudioMeta(file),
      ]);
      if (result) {
        update({
          audioFile: result.key,
          audioMeta: { ...data.audioMeta, ...meta },
        });
      }
    } finally {
      setUploading(null);
      if (audioInputRef.current) audioInputRef.current.value = '';
    }
  };

  const openAudioPicker = async () => {
    setPickerOpen(true);
    setPickerLoading(true);
    const items = await fetchAudioAssets();
    setPickerItems(items);
    setPickerLoading(false);
  };

  const selectFromLibrary = async (item: AudioPickerItem) => {
    setPickerSelecting(item.key);
    // 讀取 duration
    const url = `${API_BASE}/api/assets/${item.key.split('/').map(encodeURIComponent).join('/')}`;
    const duration = await readDurationFromUrl(url);
    const ext = item.key.split('.').pop()?.toLowerCase() || '';
    const bitrate =
      duration > 0 ? Math.round((item.size * 8) / duration / 1000) : undefined;
    update({
      audioFile: item.key,
      audioMeta: {
        ...data.audioMeta,
        size: item.size,
        duration: Math.round(duration * 100) / 100,
        bitrate,
        format: ext,
      },
    });
    setPickerSelecting(null);
    setPickerOpen(false);
  };

  const handleRemoveOnly = () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === 'audio') {
      update({ audioFile: null, audioMeta: null });
    } else {
      update({ coverImage: null });
    }
    setDeleteConfirm(null);
  };

  const handleDeleteFromLibrary = async () => {
    if (!deleteConfirm) return;
    const key = deleteConfirm.key;
    // 先移除引用
    if (deleteConfirm.type === 'audio') {
      update({ audioFile: null, audioMeta: null });
    } else {
      update({ coverImage: null });
    }
    setDeleteConfirm(null);
    // 再從 R2 刪除
    try {
      await deleteAsset(key);
    } catch (err) {
      console.error('刪除媒體庫檔案失敗:', err);
    }
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading('cover');
    try {
      const result = await uploadAsset(file);
      if (result) {
        update({ coverImage: result.key });
      }
    } finally {
      setUploading(null);
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  const updateAppreciation = (index: number, value: string) => {
    const next = [...data.appreciation];
    next[index] = value;
    update({ appreciation: next });
  };

  const addAppreciation = () => {
    update({ appreciation: [...data.appreciation, ''] });
  };

  const removeAppreciation = (index: number) => {
    update({ appreciation: data.appreciation.filter((_, i) => i !== index) });
  };

  return (
    <div className="ned-echoes-body">
      {/* 副標題 */}
      <label className="ned-field-label">副標題</label>
      <input
        className="ned-field"
        type="text"
        value={data.subtitle}
        placeholder="副標題"
        onChange={(e) => update({ subtitle: e.target.value })}
      />

      {/* 分類與等級放左側；右側只顯示目前選取等級的離開條件。 */}
      <div className="ned-echoes-row">
        <div className="ned-echoes-settings">
          <div>
            <label className="ned-field-label">分類</label>
            <select className="ned-field" value={data.category} disabled>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <div className="ned-gate-scope-hint">
              分類由歌曲所在的分區決定，要改分類請把頁面移到別的分區。
            </div>
          </div>
          <div className="ned-spoiler-level-control">
            <label className="ned-field-label">遮蔽等級 (Spoiler Level)</label>
            {data.category === 'story' ? (
              <div className="ned-spoiler-story-note">
                劇情歌由 Echo Spot 觸發時直接解鎖並插播，不使用 Spoiler Level。
              </div>
            ) : (
              <div className="ned-spoiler-buttons" role="tablist">
                {SPOILER_LEVELS.map((o) => (
                  <button
                    key={o.l}
                    className={`ned-spoiler-btn ${selectedSpoilerLevel === o.l ? 'is-active' : ''}${o.l > 0 && gateForLevel(o.l as 1 | 2 | 3) ? ' has-gate' : ''}`}
                    style={{
                      borderColor:
                        selectedSpoilerLevel === o.l
                          ? accent
                          : 'var(--hairline-strong)',
                      background:
                        selectedSpoilerLevel === o.l
                          ? `${accent}12`
                          : 'transparent',
                      color:
                        selectedSpoilerLevel === o.l
                          ? accent
                          : 'var(--ink-soft)',
                    }}
                    onClick={() => selectSpoilerLevel(o.l as SpoilerLevel)}
                    type="button"
                    role="tab"
                    aria-selected={selectedSpoilerLevel === o.l}
                  >
                    L{o.l}
                    <span className="ned-spoiler-btn-label">{o.n}</span>
                    {o.l > 0 && gateForLevel(o.l as 1 | 2 | 3) && (
                      <span className="ned-spoiler-btn-gate">已設條件</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="ned-spoiler-condition-panel">
          <label className="ned-field-label">Level 離開條件</label>
          {data.category === 'story' ? (
            <div className="ned-spoiler-condition-empty">
              劇情歌沒有 Spoiler 條件。
            </div>
          ) : selectedSpoilerLevel === null ? (
            <div className="ned-spoiler-condition-empty">
              選擇左側 Level 後即可設定離開條件；未設定任何條件時，前台視為 L0。
            </div>
          ) : selectedSpoilerLevel === 0 ? (
            <div className="ned-spoiler-condition-empty">
              L0 為完全開放，沒有離開條件。
            </div>
          ) : (
            <div className="ned-spoiler-inline-gate">
              <div className="ned-spoiler-inline-gate__heading">
                <strong>離開 L{selectedSpoilerLevel} 的條件</strong>
                <span>
                  通過後前往下一個有設定條件的較低 Level；沒有時只降一級。
                </span>
              </div>
              <GateConditionEditor
                value={gateForLevel(selectedSpoilerLevel)}
                onChange={(next) => setSpoilerGate(selectedSpoilerLevel, next)}
                apiBase={apiBase}
                accent={accent}
                showScopeHint={false}
              />
            </div>
          )}
        </div>
      </div>
      {/* 跨 zone 身分。解鎖條件本身由右側 Inspector 的 gate 編輯器管理。 */}
      <div className="ned-echoes-entity-section">
        {data.category === 'story' ? (
          <>
            <EntityKeyField
              value={data.storyKey}
              existingKeys={otherStoryKeys}
              onChange={(storyKey) => update({ storyKey })}
              label="劇情點ID"
              placeholder="如 rain-sea-finale（選填）"
              duplicateMessage="此劇情點ID 已被其他歌曲使用"
            />
            <div className="ned-gate-scope-hint">
              未設定劇情點 key 的劇情歌只能透過 Echo Spot
              插播聆聽，無法進入收藏池、也無法與插圖互聯。同一個 key
              可以同時掛在 Visuals 的插圖上——歌與圖會被視為同一個劇情點的兩面。
            </div>
          </>
        ) : (
          <>
            <EntityKeyField
              value={data.entityKey}
              existingKeys={otherEntityKeys}
              onChange={(entityKey) => update({ entityKey })}
            />
            <div className="ned-gate-scope-hint">
              實體ID 用於角色／區域嵌入反查歌曲，也是收藏旗標的來源；
              留空的歌曲不會進入收藏池。
            </div>
          </>
        )}
        {(data.entityKey || data.storyKey) &&
          entityKeyCheckStatus === 'error' && (
            <button
              type="button"
              className="ned-btn-ghost ned-btn-sm"
              onClick={() => setEntityKeyReload((value) => value + 1)}
            >
              重試唯一性查核
            </button>
          )}
      </div>

      {data.category !== 'story' && (
        <>
          {/* 舊 metadata.gate 字串已拆為 spoilerGate，避免覆蓋真正的 GateCondition。 */}
          <label className="ned-field-label">Spoiler 警告提示文案</label>
          <input
            className="ned-field"
            type="text"
            value={data.spoilerGate}
            placeholder="例如：讀過第三章後再聆聽"
            onChange={(e) => update({ spoilerGate: e.target.value })}
          />
        </>
      )}

      {validationIssues.length > 0 && (
        <div className="ned-echoes-validation" role="alert">
          {validationIssues.map((issue) => (
            <div key={issue}>⚠ {issue}</div>
          ))}
        </div>
      )}

      {/* 音檔 */}
      <label className="ned-field-label">音檔</label>
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={handleAudioUpload}
      />
      <div className="ned-audio-zone">
        {data.audioFile ? (
          <>
            <div
              className="ned-audio-icon"
              style={{ borderColor: accent, color: accent }}
            >
              {data.audioMeta?.format
                ? data.audioMeta.format.toUpperCase()
                : data.audioMeta?.size
                  ? `${Math.round((data.audioMeta.size || 0) / 1024 / 1024)}MB`
                  : '♪'}
            </div>
            <div className="ned-audio-info">
              <div className="ned-audio-name">
                {data.audioFile.split('/').pop()}
              </div>
              <div className="ned-audio-meta">
                {[
                  data.audioMeta?.format && data.audioMeta.format.toUpperCase(),
                  data.audioMeta?.bitrate && `${data.audioMeta.bitrate}kbps`,
                  data.audioMeta?.duration != null &&
                    fmtDuration(data.audioMeta.duration),
                  data.audioMeta?.size &&
                    `${(data.audioMeta.size / 1024 / 1024).toFixed(1)}MB`,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'uploaded'}
              </div>
            </div>
            <button
              className="ned-btn-ghost ned-btn-sm"
              type="button"
              onClick={() => audioInputRef.current?.click()}
              disabled={uploading === 'audio'}
              aria-busy={uploading === 'audio'}
            >
              {uploading === 'audio' ? (
                <UploadSpinner label="上傳中" />
              ) : (
                '替換'
              )}
            </button>
            <button
              className="ned-btn-ghost ned-btn-sm"
              type="button"
              onClick={openAudioPicker}
            >
              媒體庫
            </button>
            <button
              className="ned-btn-ghost ned-btn-sm"
              type="button"
              onClick={() =>
                setDeleteConfirm({ type: 'audio', key: data.audioFile! })
              }
            >
              刪除
            </button>
          </>
        ) : (
          <div style={{ display: 'flex', gap: 8, width: '100%' }}>
            <button
              className="ned-btn-ghost"
              type="button"
              onClick={() => audioInputRef.current?.click()}
              disabled={uploading === 'audio'}
              aria-busy={uploading === 'audio'}
              style={{ flex: 1, textAlign: 'center', padding: '14px' }}
            >
              {uploading === 'audio' ? <UploadSpinner /> : '+ 上傳音檔'}
            </button>
            <button
              className="ned-btn-ghost"
              type="button"
              onClick={openAudioPicker}
              style={{ flex: 1, textAlign: 'center', padding: '14px' }}
            >
              📂 從媒體庫選擇
            </button>
          </div>
        )}
      </div>

      {/* 音檔 Metadata（音檔存在時顯示）*/}
      {data.audioFile && (
        <div className="ned-audio-meta-section">
          <div className="ned-meta-row">
            <div>
              <label className="ned-field-label ned-field-label--sm">
                曲名
              </label>
              <input
                className="ned-field ned-field--sm"
                type="text"
                value={data.audioMeta?.title || ''}
                placeholder="曲名"
                onChange={(e) => updateAudioMeta({ title: e.target.value })}
              />
            </div>
            <div>
              <label className="ned-field-label ned-field-label--sm">
                演出者
              </label>
              <input
                className="ned-field ned-field--sm"
                type="text"
                value={data.audioMeta?.artist || ''}
                placeholder="演出者 / 作曲者"
                onChange={(e) => updateAudioMeta({ artist: e.target.value })}
              />
            </div>
          </div>
          <div className="ned-meta-row">
            <div>
              <label className="ned-field-label ned-field-label--sm">
                專輯
              </label>
              <input
                className="ned-field ned-field--sm"
                type="text"
                value={data.audioMeta?.album || ''}
                placeholder="專輯名稱"
                onChange={(e) => updateAudioMeta({ album: e.target.value })}
              />
            </div>
            <div>
              <label className="ned-field-label ned-field-label--sm">
                年份
              </label>
              <input
                className="ned-field ned-field--sm"
                type="text"
                value={data.audioMeta?.year || ''}
                placeholder="年份"
                onChange={(e) => updateAudioMeta({ year: e.target.value })}
              />
            </div>
          </div>
          <div className="ned-meta-row">
            <div>
              <label className="ned-field-label ned-field-label--sm">
                類型
              </label>
              <input
                className="ned-field ned-field--sm"
                type="text"
                value={data.audioMeta?.genre || ''}
                placeholder="類型"
                onChange={(e) => updateAudioMeta({ genre: e.target.value })}
              />
            </div>
            <div>
              <label className="ned-field-label ned-field-label--sm">
                備註
              </label>
              <input
                className="ned-field ned-field--sm"
                type="text"
                value={data.audioMeta?.info || ''}
                placeholder="備註"
                onChange={(e) => updateAudioMeta({ info: e.target.value })}
              />
            </div>
          </div>
        </div>
      )}

      {/* 封面圖 */}
      <label className="ned-field-label">封面圖</label>
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleCoverUpload}
      />
      <div className="ned-cover-zone">
        {data.coverImage ? (
          <div className="ned-cover-preview">
            <img
              src={`${API_BASE}/api/assets/${data.coverImage
                .split('/')
                .map((s) => encodeURIComponent(s))
                .join('/')}`}
              alt="封面圖預覽"
              className="ned-cover-img"
            />
            <div className="ned-cover-actions">
              <div className="ned-audio-name">
                {data.coverImage.split('/').pop()}
              </div>
              <div className="ned-cover-btns">
                <button
                  className="ned-btn-ghost ned-btn-sm"
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  disabled={uploading === 'cover'}
                  aria-busy={uploading === 'cover'}
                >
                  {uploading === 'cover' ? (
                    <UploadSpinner label="上傳中" />
                  ) : (
                    '替換'
                  )}
                </button>
                <button
                  className="ned-btn-ghost ned-btn-sm"
                  type="button"
                  onClick={() =>
                    setDeleteConfirm({ type: 'cover', key: data.coverImage! })
                  }
                >
                  刪除
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            className="ned-btn-ghost"
            type="button"
            onClick={() => coverInputRef.current?.click()}
            disabled={uploading === 'cover'}
            aria-busy={uploading === 'cover'}
            style={{ width: '100%', textAlign: 'center', padding: '14px' }}
          >
            {uploading === 'cover' ? <UploadSpinner /> : '+ 選擇封面圖上傳'}
          </button>
        )}
      </div>

      {/* 賞析（可多段）*/}
      <div className="ned-appreciation-header">
        <label className="ned-field-label" style={{ margin: 0 }}>
          賞析（可多段）
        </label>
        <button
          className="ned-btn-ghost ned-btn-sm"
          type="button"
          onClick={addAppreciation}
        >
          + 新增段落
        </button>
      </div>
      <div className="ned-appreciation-list">
        {data.appreciation.map((p, i) => (
          <div key={i} className="ned-appreciation-row">
            <span className="ned-appreciation-num">{i + 1}</span>
            <textarea
              className="ned-field ned-field--textarea ned-appreciation-text"
              value={p}
              onChange={(e) => updateAppreciation(i, e.target.value)}
            />
            <button
              className="ned-appreciation-remove"
              type="button"
              onClick={() => removeAppreciation(i)}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* 賞析（鎖定時顯示）*/}
      <label className="ned-field-label">賞析（鎖定時顯示）</label>
      <textarea
        className="ned-field ned-field--textarea ned-field--italic"
        value={data.appreciationLocked}
        placeholder="鎖定時顯示的替代文字"
        onChange={(e) => update({ appreciationLocked: e.target.value })}
      />

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
              style={{ fontWeight: 600, marginBottom: 8, fontSize: '1.05em' }}
            >
              刪除{deleteConfirm.type === 'audio' ? '音檔' : '封面圖'}
            </div>
            <div
              style={{
                fontSize: '0.85em',
                color: 'var(--ink-mute, #888)',
                marginBottom: 16,
                wordBreak: 'break-all',
              }}
            >
              {deleteConfirm.key.split('/').pop()}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                📎 僅移除引用
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

      {/* 音檔選擇器 Modal */}
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
          onClick={() => setPickerOpen(false)}
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
            {/* Header */}
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
                <strong>從媒體庫選擇音檔</strong>
                <span
                  style={{
                    marginLeft: 10,
                    fontSize: '0.85em',
                    color: 'var(--ink-mute, #888)',
                  }}
                >
                  僅顯示音檔 · 孤兒檔案優先
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
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

            {/* Body */}
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
                  媒體庫中沒有音檔
                </div>
              ) : (
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                >
                  {pickerItems.map((item) => {
                    const name =
                      item.originalName ||
                      item.key.split('/').pop() ||
                      item.key;
                    const sizeMB = (item.size / 1024 / 1024).toFixed(1);
                    const isOrphan = !item.referenced;
                    const isCurrent = data.audioFile === item.key;
                    const isSelecting = pickerSelecting === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        disabled={isSelecting || isCurrent}
                        onClick={() => void selectFromLibrary(item)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '10px 14px',
                          borderRadius: 8,
                          cursor: isCurrent ? 'default' : 'pointer',
                          border: `1px solid ${isOrphan ? 'goldenrod' : isCurrent ? accent : 'var(--line, #333)'}`,
                          background: isCurrent ? `${accent}15` : 'transparent',
                          opacity: isSelecting ? 0.5 : 1,
                          textAlign: 'left',
                          width: '100%',
                          color: 'var(--ink, #ccc)',
                          fontSize: '0.9em',
                        }}
                      >
                        <span
                          style={{
                            flexShrink: 0,
                            width: 36,
                            height: 36,
                            borderRadius: 6,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: isOrphan
                              ? 'rgba(218,165,32,0.15)'
                              : 'var(--bg-elevated, #252530)',
                            fontSize: 14,
                            color: isOrphan
                              ? 'goldenrod'
                              : 'var(--ink-mute, #888)',
                          }}
                        >
                          {isOrphan ? '⚠' : '♪'}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              fontWeight: 500,
                            }}
                          >
                            {name}
                          </div>
                          <div
                            style={{
                              fontSize: '0.8em',
                              color: 'var(--ink-mute, #888)',
                              marginTop: 2,
                            }}
                          >
                            {sizeMB} MB
                            {isOrphan && (
                              <span
                                style={{ color: 'goldenrod', marginLeft: 8 }}
                              >
                                孤兒檔案
                              </span>
                            )}
                            {!isOrphan && item.referencedBy.length > 0 && (
                              <span style={{ marginLeft: 8 }}>
                                被 {item.referencedBy.length} 個頁面引用
                              </span>
                            )}
                          </div>
                        </div>
                        <span
                          style={{
                            flexShrink: 0,
                            fontSize: '0.8em',
                            color: 'var(--ink-mute, #888)',
                          }}
                        >
                          {isCurrent
                            ? '目前使用中'
                            : isSelecting
                              ? '選取中...'
                              : '選取'}
                        </span>
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
