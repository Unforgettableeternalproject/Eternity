/* global File, FormData */
import React, { useRef, useState } from 'react';

const API_BASE =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.PUBLIC_CONTENT_API_URL || 'http://localhost:8788';

interface EchoesEditorBodyProps {
  accent: string;
  initialData: EchoesData;
  onDataChange: (data: EchoesData) => void;
  onDirty: () => void;
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

export interface EchoesData {
  subtitle: string;
  category: string;
  spoilerLevel: number;
  gate: string;
  audioFile: string | null;
  audioMeta: AudioMeta | null;
  coverImage: string | null;
  appreciation: string[];
  appreciationLocked: string;
}

export function parseEchoesData(metadata: Record<string, any>): EchoesData {
  return {
    subtitle: metadata?.subtitle || '',
    category: metadata?.category || 'character',
    spoilerLevel: metadata?.spoilerLevel ?? 0,
    gate: metadata?.gate || '',
    audioFile: metadata?.audioFile || null,
    audioMeta: metadata?.audioMeta || null,
    coverImage: metadata?.coverImage || null,
    appreciation: metadata?.appreciation || [''],
    appreciationLocked: metadata?.appreciationLocked || '',
  };
}

export function serializeEchoesData(data: EchoesData): Record<string, any> {
  return {
    subtitle: data.subtitle || undefined,
    category: data.category,
    spoilerLevel: data.spoilerLevel,
    gate: data.gate || undefined,
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

/** 上傳檔案到 R2 */
async function uploadAsset(
  file: File
): Promise<{ key: string; url: string; size: number } | null> {
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch(`${API_BASE}/api/assets`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    const json = (await res.json()) as {
      ok: boolean;
      data: { key: string; url: string; size: number };
    };
    if (!json.ok) throw new Error('Upload returned ok=false');
    return json.data;
  } catch (err) {
    console.error('Upload error:', err);
    return null;
  }
}

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
    const res = await fetch(`${API_BASE}/api/assets?prefix=audio/&limit=500`);
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
  onDataChange,
  onDirty,
}: EchoesEditorBodyProps) {
  const [data, setData] = useState<EchoesData>(initialData);
  const [uploading, setUploading] = useState<'audio' | 'cover' | null>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // === 音檔選擇器 state ===
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerItems, setPickerItems] = useState<AudioPickerItem[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerSelecting, setPickerSelecting] = useState<string | null>(null);

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
      const encoded = key.split('/').map(encodeURIComponent).join('/');
      await fetch(`${API_BASE}/api/assets/${encoded}`, { method: 'DELETE' });
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

      {/* 分類 + 遮蔽等級 */}
      <div className="ned-echoes-row">
        <div>
          <label className="ned-field-label">分類</label>
          <select
            className="ned-field"
            value={data.category}
            onChange={(e) => update({ category: e.target.value })}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="ned-field-label">遮蔽等級 (Spoiler Level)</label>
          <div className="ned-spoiler-buttons">
            {SPOILER_LEVELS.map((o) => (
              <button
                key={o.l}
                className={`ned-spoiler-btn ${data.spoilerLevel === o.l ? 'is-active' : ''}`}
                style={{
                  borderColor:
                    data.spoilerLevel === o.l
                      ? accent
                      : 'var(--hairline-strong)',
                  background:
                    data.spoilerLevel === o.l ? `${accent}12` : 'transparent',
                  color: data.spoilerLevel === o.l ? accent : 'var(--ink-soft)',
                }}
                onClick={() => update({ spoilerLevel: o.l })}
                type="button"
              >
                L{o.l}
                <span className="ned-spoiler-btn-label">{o.n}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 解鎖條件 */}
      <label className="ned-field-label">解鎖條件 (劇情前置)</label>
      <input
        className="ned-field"
        type="text"
        value={data.gate}
        placeholder="哪段劇情解鎖這首歌"
        onChange={(e) => update({ gate: e.target.value })}
      />

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
            >
              替換
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
              style={{ flex: 1, textAlign: 'center', padding: '14px' }}
            >
              {uploading === 'audio' ? '上傳中...' : '+ 上傳音檔'}
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
                >
                  替換
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
            style={{ width: '100%', textAlign: 'center', padding: '14px' }}
          >
            {uploading === 'cover' ? '上傳中...' : '+ 選擇封面圖上傳'}
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
