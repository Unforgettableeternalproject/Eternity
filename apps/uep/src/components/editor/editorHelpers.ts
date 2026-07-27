/**
 * 編輯器共用工具——統一 API 存取、asset 操作、dialog/toast helper
 */

import type { uepDialog as UepDialogType } from '../ui/UepDialog';
import type { uepToast as UepToastType } from '../ui/UepToast';
// Singleton fallback：island hydration 順序不保證，全域 manager 可能尚未掛載
import { uepDialog as dialogSingleton } from '../ui/UepDialog';
import { uepToast as toastSingleton } from '../ui/UepToast';
// ── API Base ──────────────────────────────────────────────────

export const API_BASE = '';

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

// ── 互聯 key 顯示 ──────────────────────────────────────────

/**
 * 互聯 key 的統一顯示文字：命名空間中文名 + key。
 *
 * Echo Spot 與 Visual Clue 引用的是同一套命名空間（entityKey／storyKey），
 * bubble 上的字樣就該一致——各自寫死過「無 entityKey」和「插圖 xxx」，
 * 讀者無從得知兩者其實在講同一件事。
 */
export function formatInterlinkKey(
  keyType: 'entity' | 'story',
  key?: string
): string {
  const trimmed = key?.trim();
  if (!trimmed) return keyType === 'story' ? '無 storyKey' : '無 entityKey';
  return `${keyType === 'story' ? '劇情點' : '實體'} ${trimmed}`;
}

// ── Asset CRUD ──────────────────────────────────────────────

export interface UploadResult {
  key: string;
  url: string;
  size: number;
}

/** 上傳檔案到 R2（走 Astro SSR proxy，自動帶 JWT） */
export async function uploadAsset(file: File): Promise<UploadResult | null> {
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch(`/api/assets`, {
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

/** 刪除 R2 asset（走 Astro SSR proxy，自動帶 JWT） */
export async function deleteAsset(key: string): Promise<void> {
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  await fetch(`/api/assets/${encoded}`, { method: 'DELETE' });
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
    const res = await fetch(`/api/assets?prefix=images/&limit=500`);
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
    const res = await fetch(`/api/assets?prefix=audio/&limit=500`);
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

// ── HTML → Markdown 轉換（編輯器匯出用）─────────────────────

/**
 * 將 TipTap 產生的 HTML 轉為可讀的 Markdown。
 * 著重文字可讀性，複雜格式（顏色、字型大小、highlight）會被忽略。
 */
export function htmlToMarkdown(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const inner = Array.from(el.childNodes).map(walk).join('');

    switch (tag) {
      // 區塊元素
      case 'p':
        return inner.trim() ? inner + '\n\n' : '\n';
      case 'h1':
        return `# ${inner.trim()}\n\n`;
      case 'h2':
        return `## ${inner.trim()}\n\n`;
      case 'h3':
        return `### ${inner.trim()}\n\n`;
      case 'blockquote':
        return (
          inner
            .split('\n')
            .filter((l) => l.trim())
            .map((l) => `> ${l.trim()}`)
            .join('\n') + '\n\n'
        );
      case 'ul':
      case 'ol':
        return inner + '\n';
      case 'li': {
        const parent = el.parentElement?.tagName.toLowerCase();
        const prefix =
          parent === 'ol'
            ? `${Array.from(el.parentElement!.children).indexOf(el) + 1}. `
            : '- ';
        return prefix + inner.trim() + '\n';
      }
      case 'pre':
        return `\`\`\`\n${inner.trim()}\n\`\`\`\n\n`;
      case 'hr':
        return '---\n\n';
      case 'br':
        return '\n';

      // 行內格式
      case 'strong':
      case 'b':
        return `**${inner}**`;
      case 'em':
      case 'i':
        return `*${inner}*`;
      case 's':
      case 'del':
        return `~~${inner}~~`;
      case 'code':
        return el.parentElement?.tagName.toLowerCase() === 'pre'
          ? inner
          : `\`${inner}\``;
      case 'a':
        return `[${inner}](${el.getAttribute('href') || ''})`;
      case 'img':
        return `![${el.getAttribute('alt') || ''}](${el.getAttribute('src') || ''})`;

      // 格式標籤：保留文字，忽略格式
      case 'u':
      case 'mark':
      case 'span':
      case 'div':
        return inner;

      // 自訂 node：提取文字
      case 'uep-dialogue':
        return inner.trim() ? inner + '\n\n' : '';
      case 'inline-audio':
        return `🎵 ${el.getAttribute('label') || '音訊'}`;

      default:
        return inner;
    }
  }

  return (
    walk(doc.body)
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}
