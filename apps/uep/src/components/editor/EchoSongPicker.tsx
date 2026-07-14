/* global AbortController */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

export interface EchoSongChoice {
  id: string;
  title: string;
  audioFile: string;
  entityKey?: string;
  clusterId: string;
  clusterTitle: string;
  subcategoryTitle?: string;
  duration?: number;
  spoilerLevel: number;
  songType: string;
  spoilerRevisions?: unknown[];
}

interface TreeNode {
  id: string;
  title: string;
  pageType?: string;
  metadata?: Record<string, unknown>;
  children?: TreeNode[];
}

interface EchoSongPickerProps {
  apiBase: string;
  open: boolean;
  onClose: () => void;
  onSelect: (song: EchoSongChoice) => void;
}

/** 將 Echoes tree 正規化為 picker 可消費的歌曲清單。 */
export function flattenEchoSongs(tree: TreeNode[]): EchoSongChoice[] {
  const result: EchoSongChoice[] = [];

  function walk(
    nodes: TreeNode[],
    cluster?: { id: string; title: string },
    subcategoryTitle?: string
  ) {
    for (const node of nodes) {
      const nextCluster =
        node.pageType === 'cluster'
          ? { id: node.id.split('/')[1] || node.id, title: node.title }
          : cluster;
      const nextSubcategory =
        node.pageType === 'subcategory' ? node.title : subcategoryTitle;

      if (node.pageType === 'song') {
        const audioFile =
          typeof node.metadata?.audioFile === 'string'
            ? node.metadata.audioFile.trim()
            : '';
        // 沒有音檔的頁面不可建立可播放 spot；在 picker 中直接排除。
        if (audioFile) {
          const entityKey =
            typeof node.metadata?.entityKey === 'string'
              ? node.metadata.entityKey.trim()
              : '';
          const clusterId =
            nextCluster?.id || node.id.split('/')[1] || 'special';
          const category =
            typeof node.metadata?.category === 'string'
              ? node.metadata.category.trim()
              : '';
          const songType =
            category ||
            (clusterId === 'stories'
              ? 'story'
              : clusterId === 'areas'
                ? 'area'
                : clusterId === 'characters'
                  ? 'character'
                  : 'special');
          const isStory = songType === 'story' || clusterId === 'stories';
          // 特殊回憶不由 History Echo Spot 掛載；非劇情歌則必須先有
          // entityKey，確保 spot 與互動嵌入共用同一實體身分。
          if (songType === 'special' || clusterId === 'special') continue;
          if (!isStory && !entityKey) continue;
          const duration = Number(
            (node.metadata?.audioMeta as Record<string, unknown> | undefined)
              ?.duration
          );
          const spoilerLevel = Number(node.metadata?.spoilerLevel);
          const spoilerRevisions = Array.isArray(
            node.metadata?.spoilerRevisions
          )
            ? node.metadata.spoilerRevisions
            : undefined;
          result.push({
            id: node.id,
            title: node.title,
            audioFile,
            ...(entityKey ? { entityKey } : {}),
            clusterId,
            clusterTitle: nextCluster?.title || '未分類',
            songType,
            ...(nextSubcategory ? { subcategoryTitle: nextSubcategory } : {}),
            ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
            spoilerLevel: isStory
              ? 0
              : Number.isInteger(spoilerLevel) &&
                  spoilerLevel >= 0 &&
                  spoilerLevel <= 3
                ? spoilerLevel
                : 0,
            ...(!isStory && spoilerRevisions?.length
              ? { spoilerRevisions }
              : {}),
          });
        }
      }

      if (node.children?.length) {
        walk(node.children, nextCluster, nextSubcategory);
      }
    }
  }

  walk(tree);
  return result;
}

export default function EchoSongPicker({
  apiBase,
  open,
  onClose,
  onSelect,
}: EchoSongPickerProps) {
  const [songs, setSongs] = useState<EchoSongChoice[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(`${apiBase}/api/content/echoes/tree`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || '無法載入歌曲清單');
        }
        setSongs(flattenEchoSongs(payload.data || []));
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : '無法載入歌曲清單');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [apiBase, open]);

  const grouped = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-TW');
    const visible = normalized
      ? songs.filter((song) =>
          [song.title, song.id, song.entityKey, song.subcategoryTitle]
            .filter(Boolean)
            .some((value) =>
              String(value).toLocaleLowerCase('zh-TW').includes(normalized)
            )
        )
      : songs;
    const groups = new Map<string, EchoSongChoice[]>();
    for (const song of visible) {
      const key = `${song.clusterId}\u0000${song.clusterTitle}`;
      groups.set(key, [...(groups.get(key) || []), song]);
    }
    return [...groups.entries()];
  }, [query, songs]);

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
        aria-label="選擇 Echoes 曲目"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="ned-modal-header">
          <div>
            <strong>選擇 Echoes 曲目</strong>
            <div className="ned-echo-song-picker__hint">
              僅列出有音檔的劇情歌，或已有 entityKey
              的角色／區域歌曲；特殊回憶不列入。
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
            placeholder="搜尋曲名、分類、entityKey…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="ned-echo-song-picker__body">
          {loading ? (
            <div className="ned-picker-empty">正在載入歌曲…</div>
          ) : error ? (
            <div className="ned-picker-empty ned-picker-empty--error">
              {error}
            </div>
          ) : grouped.length === 0 ? (
            <div className="ned-picker-empty">
              {songs.length === 0
                ? '目前沒有已上傳音檔的歌曲。'
                : '沒有符合搜尋條件的歌曲。'}
            </div>
          ) : (
            grouped.map(([key, entries]) => {
              const [, title] = key.split('\u0000');
              return (
                <section className="ned-echo-song-picker__group" key={key}>
                  <div className="ned-echo-song-picker__group-title">
                    {title}
                    <span>{entries.length}</span>
                  </div>
                  {entries.map((song) => (
                    <button
                      type="button"
                      className="ned-echo-song-picker__song"
                      key={song.id}
                      onClick={() => onSelect(song)}
                    >
                      <span className="ned-echo-song-picker__orb">♪</span>
                      <span className="ned-echo-song-picker__song-copy">
                        <strong>{song.title}</strong>
                        <small>
                          {[song.subcategoryTitle, song.entityKey || song.id]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                      </span>
                      <span className="ned-echo-song-picker__select">選取</span>
                    </button>
                  ))}
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
