/* global AbortController */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import type { VisualClueTargetType } from './VisualClueNode';

/** picker 選中的 gallery 目標（Visual Clue 錨點的引用 + 快照） */
export interface VisualsGalleryChoice {
  /** gallery 頁 id（`visuals/...`，快照） */
  id: string;
  title: string;
  targetType: VisualClueTargetType;
  /** entityKey（陳列走廊）或插圖 ID（鑲框室） */
  targetKey: string;
  divisionId: string;
  imageCount: number;
  images: { id: string; file: string; title: string; sortOrder: number }[];
  /** 本次選擇指定的預設／直接展示圖片；只存在於 image 選擇結果。 */
  selectedImageId?: string;
  selectedImageTitle?: string;
  selectedImageFile?: string;
}

interface TreeNode {
  id: string;
  title: string;
  pageType?: string;
  metadata?: Record<string, unknown>;
  children?: TreeNode[];
}

interface VisualsGalleryPickerProps {
  apiBase: string;
  open: boolean;
  onClose: () => void;
  onSelect: (gallery: VisualsGalleryChoice) => void;
  selectionMode?: 'gallery' | 'image';
}

const DIVISION_TITLES: Record<string, string> = {
  profiles: '陳列走廊',
  illustrations: '鑲框室',
};

/**
 * 將 Visuals tree 正規化為 Visual Clue 可引用的 gallery 清單。
 *
 * 資格 = 進島規則的交集（同 canMirrorGallery 語意）：
 * 僅陳列走廊（entityKey 必備）+ 鑲框室（插圖 ID 必備）、
 * 排除精靈圖 gallery 與空 gallery。hidden 不排除——Visual Clue
 * 是對插圖的明確引用（同 by-id 反查端點的定案理由）。
 */
export function flattenClueGalleries(tree: TreeNode[]): VisualsGalleryChoice[] {
  const result: VisualsGalleryChoice[] = [];

  function walk(nodes: TreeNode[]) {
    for (const node of nodes) {
      if (node.pageType === 'gallery') {
        const divisionId = node.id.split('/')[1] || '';
        const meta = node.metadata || {};
        const imageCount = Array.isArray(meta.images) ? meta.images.length : 0;
        const images = Array.isArray(meta.images)
          ? meta.images
              .filter(
                (image): image is Record<string, unknown> =>
                  !!image &&
                  typeof image === 'object' &&
                  typeof (image as Record<string, unknown>).id === 'string' &&
                  Boolean(
                    ((image as Record<string, unknown>).id as string).trim()
                  )
              )
              .map((image, index) => ({
                id: image.id as string,
                file: typeof image.file === 'string' ? image.file : '',
                title:
                  typeof image.caption === 'string' && image.caption.trim()
                    ? image.caption
                    : `第 ${index + 1} 張`,
                sortOrder:
                  typeof image.sortOrder === 'number' ? image.sortOrder : index,
              }))
              .sort((a, b) => a.sortOrder - b.sortOrder)
          : [];
        const entityKey =
          typeof meta.entityKey === 'string' ? meta.entityKey.trim() : '';
        const illustrationId =
          typeof meta.illustrationId === 'string'
            ? meta.illustrationId.trim()
            : '';
        const isSprite = meta.layout === 'sprite';

        if (!isSprite && imageCount > 0) {
          if (divisionId === 'profiles' && entityKey) {
            result.push({
              id: node.id,
              title: node.title,
              targetType: 'entity',
              targetKey: entityKey,
              divisionId,
              imageCount,
              images,
            });
          } else if (divisionId === 'illustrations' && illustrationId) {
            result.push({
              id: node.id,
              title: node.title,
              targetType: 'illustration',
              targetKey: illustrationId,
              divisionId,
              imageCount,
              images,
            });
          }
        }
      }
      if (node.children?.length) walk(node.children);
    }
  }

  walk(tree);
  return result;
}

export default function VisualsGalleryPicker({
  apiBase,
  open,
  onClose,
  onSelect,
  selectionMode = 'gallery',
}: VisualsGalleryPickerProps) {
  const [galleries, setGalleries] = useState<VisualsGalleryChoice[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(`${apiBase}/api/content/visuals/tree`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || '無法載入畫廊清單');
        }
        setGalleries(flattenClueGalleries(payload.data || []));
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : '無法載入畫廊清單');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [apiBase, open]);

  const grouped = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-TW');
    const visible = normalized
      ? galleries.filter((gallery) =>
          [gallery.title, gallery.id, gallery.targetKey]
            .filter(Boolean)
            .some((value) =>
              String(value).toLocaleLowerCase('zh-TW').includes(normalized)
            )
        )
      : galleries;
    const groups = new Map<string, VisualsGalleryChoice[]>();
    for (const gallery of visible) {
      groups.set(gallery.divisionId, [
        ...(groups.get(gallery.divisionId) || []),
        gallery,
      ]);
    }
    return [...groups.entries()];
  }, [query, galleries]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="ned-modal-backdrop ned-echo-song-picker-backdrop"
      onMouseDown={onClose}
    >
      <div
        className="ned-modal-card ned-echo-song-picker"
        role="dialog"
        aria-modal="true"
        aria-label="選擇 Visuals 畫廊"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="ned-modal-header">
          <div>
            <strong>
              {selectionMode === 'image'
                ? '選擇 Visuals 圖片'
                : '選擇 Visuals 畫廊與預設圖'}
            </strong>
            <div className="ned-echo-song-picker__hint">
              僅列出可進浮動幻影的畫廊：陳列走廊需 entityKey、鑲框室需插圖
              ID；精靈圖與空畫廊不列入。
            </div>
          </div>
          <button type="button" className="ned-modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="ned-echo-song-picker__search">
          <input
            className="ned-field"
            autoFocus
            value={query}
            placeholder="搜尋畫廊名稱、entityKey、插圖 ID…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="ned-echo-song-picker__body">
          {loading ? (
            <div className="ned-picker-empty">正在載入畫廊…</div>
          ) : error ? (
            <div className="ned-picker-empty ned-picker-empty--error">
              {error}
            </div>
          ) : grouped.length === 0 ? (
            <div className="ned-picker-empty">
              {galleries.length === 0
                ? '目前沒有可引用的畫廊。'
                : '沒有符合搜尋條件的畫廊。'}
            </div>
          ) : (
            grouped.map(([divisionId, entries]) => (
              <section className="ned-echo-song-picker__group" key={divisionId}>
                <div className="ned-echo-song-picker__group-title">
                  {DIVISION_TITLES[divisionId] || divisionId}
                  <span>{entries.length}</span>
                </div>
                {entries.map((gallery) => (
                  <div key={gallery.id}>
                    <button
                      type="button"
                      className="ned-echo-song-picker__song"
                      onClick={() => {
                        if (selectionMode !== 'gallery') return;
                        const first = gallery.images[0];
                        onSelect({
                          ...gallery,
                          ...(first
                            ? {
                                selectedImageId: first.id,
                                selectedImageTitle: first.title,
                                selectedImageFile: first.file,
                              }
                            : {}),
                        });
                      }}
                      disabled={selectionMode === 'image'}
                    >
                      <span className="ned-echo-song-picker__orb">❏</span>
                      <span className="ned-echo-song-picker__song-copy">
                        <strong>{gallery.title}</strong>
                        <small>
                          {[
                            gallery.targetKey,
                            `${gallery.imageCount} 張圖片`,
                          ].join(' · ')}
                        </small>
                      </span>
                      {selectionMode === 'gallery' && (
                        <span className="ned-echo-song-picker__select">
                          第一張開始
                        </span>
                      )}
                    </button>
                    <div className="ned-echo-song-picker__image-choices">
                      {gallery.images.map((image, index) => (
                        <button
                          type="button"
                          className="ned-img-bubble-btn"
                          key={image.id}
                          onClick={() =>
                            onSelect({
                              ...gallery,
                              selectedImageId: image.id,
                              selectedImageTitle: image.title,
                              selectedImageFile: image.file,
                            })
                          }
                        >
                          {String(index + 1).padStart(2, '0')} · {image.title}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
