/**
 * VisualsIsland —「浮動幻影」（S8 下半場 V-C）
 *
 * 事件驅動的典型圖片檢視器：一次展示一整個 gallery（僅陳列走廊 +
 * 鑲框室），無佇列、Visuals zone 內預設閉幕。內容來源三種（映照 /
 * entity 嵌入提示 / Visual Clue），全部經 phantomBridge 進來，島本體
 * 不主動抓資料。
 *
 * 檢視器格局：大圖舞台（左右箭頭）+ caption 列 + 三態縮圖快切列
 * （A 鎖定格不載圖、B 模糊縮圖、C 正常）。三態求值與 Reader 同一條
 * 路徑（visuals/resolveGalleryImages），訂閱 useProgress 即時反應
 * 進度變化。gallery 閘由投射來源把關（只投已解鎖 gallery）。
 *
 * 視覺語彙：無設計稿原型（同 History 島前例），第一版功能骨架優先
 * ——除 Concepts 外各島後續會統一重調更 immersive（艾斯維爾 07/19）。
 *
 * 視窗外殼（拖曳/收合/手機 bottom sheet）由 DraggableIsland 提供，
 * 這裡只有 body。收合＝unmount：目前投射存 window（phantomBridge），
 * 展開後續示，與流浪回聲「收合即暫停」的旗標手法同源。
 */
import React, { useEffect, useMemo, useState } from 'react';

import { isGalleryUnlockedInZone } from '../../components/visuals/visualsVisibility';
import { getApiBase } from '../../lib/apiBase';
import { useProgress } from '../../progress';
import { resolveGalleryImages } from '../../visuals';
import type { ResolvedGalleryImage } from '../../visuals';

import {
  clearPhantomGallery,
  consumePhantomSuggestion,
  getPhantomGallery,
  hasClueSnapshot,
  pushPhantomGallery,
  requestClueClear,
  UEP_PHANTOM_SHOW_EVENT,
  UEP_PHANTOM_SUGGESTION_EVENT,
} from './phantomBridge';
import type { PhantomGallery, PhantomImage } from './phantomBridge';

import './VisualsIsland.css';

const API_BASE = getApiBase();

/** 裸 R2 key → 資產 URL（文件站 bucket，同 Reader 的 buildImageUrl） */
function imageUrl(key: string): string {
  return `${API_BASE}/api/assets/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** 來源標籤（caption 列的小字） */
const SOURCE_LABELS: Record<PhantomGallery['source'], string> = {
  mirror: 'MIRRORED',
  embed: 'RESONATED',
  clue: 'REVEALED',
};

type PhantomImageView = ResolvedGalleryImage<PhantomImage>;

/** A 鎖定格——不載入實際圖片（劇透保護，同 Reader LockedImageCell） */
function LockedCell({ compact }: { compact?: boolean }) {
  return (
    <div
      className={`uep-visland__locked${compact ? ' is-compact' : ''}`}
      aria-label="尚未解鎖的圖片"
    >
      <span aria-hidden>⛉</span>
      {!compact && <small>LOCKED</small>}
    </div>
  );
}

export default function VisualsIsland() {
  const progress = useProgress();

  /** 目前投射的 gallery：mount 時讀回 window 值（收合後展開續示） */
  const [gallery, setGallery] = useState<PhantomGallery | null>(() =>
    getPhantomGallery()
  );
  /** 檢視索引（依 sortOrder 排序後的序位） */
  const [idx, setIdx] = useState(0);

  /** entity 嵌入提示卡（V-C .25）：pending 消費 + 展開中即時接收 */
  const [suggestion, setSuggestion] = useState<PhantomGallery | null>(null);

  useEffect(() => {
    const onShow = (event: Event) => {
      // detail null = 清空投射（clue 插播前一片空白的恢復路徑，V-D）
      const detail = (event as CustomEvent<PhantomGallery | null>).detail;
      setGallery(detail ?? null);
      setIdx(0);
    };
    window.addEventListener(UEP_PHANTOM_SHOW_EVENT, onShow);
    return () => window.removeEventListener(UEP_PHANTOM_SHOW_EVENT, onShow);
  }, []);

  useEffect(() => {
    const pending = consumePhantomSuggestion();
    if (pending) setSuggestion(pending);
    const onSuggestion = (event: Event) => {
      // detail null = 清除提示（entity 啟用反查失敗／不合格時，避免
      // 舊卡殘留誤導與新 entity 有關）
      const detail = (event as CustomEvent<PhantomGallery | null>).detail;
      window.__uepPhantomSuggestion = null;
      setSuggestion(detail ?? null);
    };
    window.addEventListener(UEP_PHANTOM_SUGGESTION_EVENT, onSuggestion);
    return () =>
      window.removeEventListener(UEP_PHANTOM_SUGGESTION_EVENT, onSuggestion);
  }, []);

  /** 按「展示」：提示轉正式投射（push 的事件迴路會更新 gallery state） */
  function showSuggestion() {
    if (!suggestion) return;
    pushPhantomGallery(suggestion);
    setSuggestion(null);
  }

  /**
   * 清除目前投射（#4 追加）：clue 插播中 → 只取消這次插播、復原插播前的
   * 快照，並請 HistoryReader 撤下對應的進行中書籤（雙向對應）；非插播 →
   * 全清（clearPhantomGallery 廣播空狀態）。
   */
  function clearProjection() {
    if (hasClueSnapshot()) {
      requestClueClear();
      return;
    }
    clearPhantomGallery();
  }

  /**
   * gallery 閘再驗證（進度變化即時重算）：投射只在來源端把關一次，
   * pristineOnly 這類條件可在投射後失效——閘不再通過時整島呈封印態，
   * 不繼續展示圖片。無 zone tree，本頁 gate 求值（同 entity-song
   * 已知限制）；推導旗標（clue 授旗）可維持解鎖、static locked 優先。
   * 缺 gate/locked 快照的舊投射視為無條件（向後相容）。
   */
  const galleryUnlocked = useMemo(
    () =>
      !gallery ||
      isGalleryUnlockedInZone(
        {
          id: gallery.id,
          metadata: {
            entityKey: gallery.entityKey ?? null,
            gate: gallery.gate ?? null,
            locked: gallery.locked === true,
          },
        },
        progress
      ),
    [gallery, progress]
  );

  /** 三態求值（同 Reader 路徑；進度變化即時重算） */
  const items: PhantomImageView[] = useMemo(
    () =>
      gallery && galleryUnlocked
        ? resolveGalleryImages(gallery.images, progress)
        : [],
    [gallery, galleryUnlocked, progress]
  );

  /** 提示卡（有無投射都要能出現——嵌入提示可能先於任何投射） */
  const suggestionCard = suggestion && (
    <div className="uep-visland__suggestion">
      <span className="uep-visland__suggestion-dot" aria-hidden />
      <div className="uep-visland__suggestion-copy">
        <small>RELATED VISUAL</small>
        <strong title={suggestion.title}>{suggestion.title}</strong>
      </div>
      <button type="button" onClick={showSuggestion}>
        展示
      </button>
      <button
        type="button"
        className="is-dismiss"
        onClick={() => setSuggestion(null)}
      >
        忽略
      </button>
    </div>
  );

  if (!gallery) {
    return (
      <div className="uep-visland">
        {suggestionCard}
        <div className="uep-visland--empty">
          畫框裡還是一片空白。
          <br />
          去幻影重現室把畫作映照過來吧。
        </div>
      </div>
    );
  }

  const safeIdx = items.length > 0 ? Math.min(idx, items.length - 1) : 0;
  const current = items[safeIdx] ?? null;
  const locked = current?.state === 'locked';
  const partial = current?.state === 'partial';

  const prev = () => setIdx((safeIdx - 1 + items.length) % items.length);
  const next = () => setIdx((safeIdx + 1) % items.length);

  return (
    <div className="uep-visland">
      {suggestionCard}

      {/* ── 標頭：投射中的 gallery ── */}
      <div className="uep-visland__header">
        <span className="uep-visland__kicker">
          {SOURCE_LABELS[gallery.source]}
        </span>
        <span className="uep-visland__title" title={gallery.title}>
          {gallery.title}
        </span>
        <button
          type="button"
          className="uep-visland__clear"
          onClick={clearProjection}
          title="清除目前投射"
          aria-label="清除目前投射"
        >
          <span aria-hidden>×</span>
        </button>
      </div>

      {!galleryUnlocked ? (
        <div className="uep-visland__placeholder">
          <span aria-hidden>⛉</span> 這個畫廊的封印又閉合了，畫框暫時蒙上了霧。
        </div>
      ) : items.length === 0 ? (
        <div className="uep-visland__placeholder">這個畫廊還沒有影像。</div>
      ) : (
        <>
          {/* ── 大圖舞台（左右箭頭） ── */}
          <div className="uep-visland__stage">
            {items.length > 1 && (
              <button
                type="button"
                className="uep-visland__arrow is-left"
                onClick={prev}
                aria-label="上一張"
              >
                ‹
              </button>
            )}
            <div
              className={`uep-visland__frame${partial ? ' is-partial' : ''}${locked ? ' is-locked' : ''}`}
            >
              {locked ? (
                <LockedCell />
              ) : (
                <img
                  src={imageUrl(current!.img.file)}
                  alt={current!.img.caption || gallery.title}
                  draggable={false}
                />
              )}
            </div>
            {items.length > 1 && (
              <button
                type="button"
                className="uep-visland__arrow is-right"
                onClick={next}
                aria-label="下一張"
              >
                ›
              </button>
            )}
          </div>

          {/* ── caption 列 ── */}
          <div className="uep-visland__caption">
            <span className="uep-visland__counter">
              {String(safeIdx + 1).padStart(2, '0')} /{' '}
              {String(items.length).padStart(2, '0')}
            </span>
            <span className="uep-visland__caption-text">
              {locked ? '？？？' : current!.img.caption || gallery.title}
              {partial && (
                <em className="uep-visland__partial-tag">・尚未完全顯現</em>
              )}
            </span>
          </div>

          {/* ── 三態縮圖快切列 ── */}
          <div className="uep-visland__strip" role="list">
            {items.map((it, i) => (
              <button
                key={it.img.id || `${it.img.file}-${i}`}
                type="button"
                role="listitem"
                className={`uep-visland__thumb${i === safeIdx ? ' is-active' : ''}${it.state === 'partial' ? ' is-partial' : ''}`}
                onClick={() => setIdx(i)}
                aria-label={
                  it.state === 'locked'
                    ? `第 ${i + 1} 張（未解鎖）`
                    : `檢視第 ${i + 1} 張`
                }
              >
                {it.state === 'locked' ? (
                  <LockedCell compact />
                ) : (
                  <img src={imageUrl(it.img.file)} alt="" draggable={false} />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
