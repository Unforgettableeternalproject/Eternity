/**
 * 編輯器共用工具——統一 API 存取、asset 操作、dialog/toast helper
 */

import type { uepDialog as UepDialogType } from '../ui/UepDialog';
import type { uepToast as UepToastType } from '../ui/UepToast';
// Singleton fallback：island hydration 順序不保證，全域 manager 可能尚未掛載
import { uepDialog as dialogSingleton } from '../ui/UepDialog';
import { uepToast as toastSingleton } from '../ui/UepToast';

// ── API Base ──────────────────────────────────────────────────

export const API_BASE =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.PUBLIC_CONTENT_API_URL || 'http://localhost:8788';

// ── Dialog / Toast（跨 React island 安全取法）─────────────────

export function getDialog(): typeof UepDialogType {
  return (window as any).__uepDialogManager ?? dialogSingleton;
}

export function getToast(): typeof UepToastType {
  return (window as any).__uepToastManager ?? toastSingleton;
}

// ── Asset URL 工具 ──────────────────────────────────────────

/** 將 R2 key 轉為完整的 asset URL */
export function buildAssetUrl(key: string): string {
  if (key.startsWith('/api/assets/')) {
    const path = key.slice('/api/assets/'.length);
    return `${API_BASE}/api/assets/${path.split('/').map(encodeURIComponent).join('/')}`;
  }
  return `${API_BASE}/api/assets/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** 將裸 R2 key 轉為統一的 /api/assets/ 路徑 */
export function toAssetPath(key: string): string {
  return key.startsWith('/api/assets/') ? key : `/api/assets/${key}`;
}

/** 從 src URL 提取 R2 key */
export function extractAssetKey(src: string): string | null {
  const marker = '/api/assets/';
  const idx = src.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(src.slice(idx + marker.length));
}

// ── Asset CRUD ──────────────────────────────────────────────

export interface UploadResult {
  key: string;
  url: string;
  size: number;
}

/** 上傳檔案到 R2 */
export async function uploadAsset(file: File): Promise<UploadResult | null> {
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
      data: UploadResult;
    };
    if (!json.ok) throw new Error('Upload returned ok=false');
    return json.data;
  } catch (err) {
    console.error('Upload error:', err);
    return null;
  }
}

/** 刪除 R2 asset */
export async function deleteAsset(key: string): Promise<void> {
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  await fetch(`${API_BASE}/api/assets/${encoded}`, { method: 'DELETE' });
}

// ── Asset 列表查詢 ──────────────────────────────────────────

export interface AssetItem {
  key: string;
  size: number;
  contentType: string;
  originalName: string;
  referenced: boolean;
  referencedBy?: string[];
}

/** 取得圖片列表（孤兒排前面）*/
export async function fetchImageAssets(): Promise<AssetItem[]> {
  try {
    const res = await fetch(`${API_BASE}/api/assets?prefix=images/&limit=500`);
    if (!res.ok) return [];
    const json = (await res.json()) as {
      ok: boolean;
      data: { items: AssetItem[] };
    };
    if (!json.ok) return [];
    const items = json.data.items.filter(
      (i) => i.contentType?.startsWith('image/') || i.key.startsWith('images/')
    );
    items.sort((a, b) => {
      if (a.referenced === b.referenced) return 0;
      return a.referenced ? 1 : -1;
    });
    return items;
  } catch {
    return [];
  }
}

/** 取得音檔列表（孤兒排前面）*/
export async function fetchAudioAssets(): Promise<AssetItem[]> {
  try {
    const res = await fetch(`${API_BASE}/api/assets?prefix=audio/&limit=500`);
    if (!res.ok) return [];
    const json = (await res.json()) as {
      ok: boolean;
      data: { items: AssetItem[] };
    };
    if (!json.ok) return [];
    const items = json.data.items.filter(
      (i) => i.contentType?.startsWith('audio/') || i.key.startsWith('audio/')
    );
    items.sort((a, b) => {
      if (a.referenced === b.referenced) return 0;
      return a.referenced ? 1 : -1;
    });
    return items;
  } catch {
    return [];
  }
}
