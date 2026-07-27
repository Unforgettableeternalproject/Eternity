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
import { useIslandChrome } from '../islandChrome';
import RelatedClueCard from '../RelatedClueCard';
import { subscribeRelated } from '../relatedBridge';
import type { IslandRelatedDetail } from '../types';
import { navigateToZonePage } from '../zoneNavigation';

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
  const chrome = useIslandChrome();

  /** 目前投射的 gallery：mount 時讀回 window 值（收合後展開續示） */
  const [gallery, setGallery] = useState<PhantomGallery | null>(() =>
    getPhantomGallery()
  );
  /** 檢視索引（依 sortOrder 排序後的序位） */
  const [idx, setIdx] = useState(0);

  /** entity 嵌入提示卡（V-C .25）：pending 消費 + 展開中即時接收 */
  const [suggestion, setSuggestion] = useState<PhantomGallery | null>(null);

  /**
   * 跨區互聯線索：讀者在 Concepts 點了某個條目的「相關」，那個 entity
   * 對應的畫廊就浮在這裡。一次一則，點掉／換頁／重整就消失。
   *
   * 走 relatedBridge 而非直接訂閱事件——島收合時這個元件沒有 mount，
   * 事件無狀態、事後補不回來（監聽常駐在 IslandHost）。
   */
  const [related, setRelated] = useState<IslandRelatedDetail | null>(null);
  useEffect(() => subscribeRelated('visuals', setRelated), []);

  // 跨頁／收合後重建 island 時，持久化投射的指定圖片仍要成為目前畫面。
  useEffect(() => {
    if (!gallery?.initialImageId) return;
    const targetIndex = [...gallery.images]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .findIndex((image) => image.id === gallery.initialImageId);
    if (targetIndex >= 0) setIdx(targetIndex);
  }, [gallery?.id, gallery?.initialImageId]);

  useEffect(() => {
    const onShow = (event: Event) => {
      // detail null = 清空投射（clue 插播前一片空白的恢復路徑，V-D）
      const detail = (event as CustomEvent<PhantomGallery | null>).detail;
      setGallery(detail ?? null);
      const targetIndex = detail?.initialImageId
        ? [...detail.images]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .findIndex((image) => image.id === detail.initialImageId)
        : 0;
      setIdx(targetIndex >= 0 ? targetIndex : 0);
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
        ? resolveGalleryImages(gallery.images, progress, gallery.id)
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

  /**
   * 換片識別：投射整個換掉時（映照／嵌入／clue 插播／clue 復原／清空）
   * 讓畫框重播一次投影動畫，換片才有「打上另一張幻燈片」的過程，而不是
   * 內容瞬間被抽換。同一 gallery 內左右翻頁不算換片，key 不變。
   */
  const projectionKey = gallery ? `${gallery.source}:${gallery.id}` : 'empty';

  const safeIdx = items.length > 0 ? Math.min(idx, items.length - 1) : 0;
  const current = items[safeIdx] ?? null;
  const locked = current?.state === 'locked';
  const partial = current?.state === 'partial';
  /** 有畫可放才進舞台模式；其餘一律走「空畫框 + ghost」 */
  const projecting = gallery !== null && galleryUnlocked && items.length > 0;

  const prev = () => setIdx((safeIdx - 1 + items.length) % items.length);
  const next = () => setIdx((safeIdx + 1) % items.length);

  /**
   * 空畫框內的說明。
   * 設計稿定的原則：**畫框與縮圖格永遠在，只是空的**——空狀態時島仍然是
   * 一件投影裝置，不是一行灰字。三種空法（沒投射／封印關上／畫廊無圖）
   * 共用同一個畫框，只換裡面的字。
   */
  const ghost =
    gallery === null ? (
      <>
        <b>EMPTY FRAME</b>
        畫框還空著。
        <br />
        去幻影重現室
        <br />
        把畫作映照過來。
      </>
    ) : !galleryUnlocked ? (
      <>
        <b>SEALED</b>
        這個畫廊的封印又閉合了，
        <br />
        畫框暫時蒙上了霧。
      </>
    ) : (
      <>
        <b>NO IMAGE</b>
        這個畫廊還沒有影像。
      </>
    );

  return (
    <div className="uep-visland">
      {/* ── 投影裝置的光學層（純裝飾） ── */}
      <span className="uep-visland__cone" aria-hidden />
      <span className="uep-visland__scan" aria-hidden />
      <span className="uep-visland__haze" aria-hidden />

      {chrome.bare && (
        <button
          type="button"
          className="uep-island-close uep-visland__dismiss"
          onClick={chrome.requestClose}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="收合浮動幻影"
          title="收合"
        >
          散去
        </button>
      )}

      {/* ── 島頭（＝拖曳把手）：島名在上、投射中的 gallery 在下 ──
          島名與內容標題分層，是為了讓五座島「叫什麼」都落在同一處
          （之前這裡只有 gallery 標題，島本身沒有名字）。
          ⚠️ 必須排在 suggestion 卡之前：島頭是固定物，收合鈕又是相對島
          絕對定位的，若被提示卡往下推，兩者會錯開甚至疊住。 */}
      <div className="uep-visland__masthead" {...chrome.dragHandleProps}>
        <div className="uep-island-title uep-visland__name">浮動幻影</div>
        <div className="uep-visland__rule" aria-hidden />
        <div className="uep-visland__header">
          <span className="uep-visland__kicker">
            {gallery ? SOURCE_LABELS[gallery.source] : 'NO PROJECTION'}
          </span>
          <span
            className={`uep-visland__title${gallery ? '' : ' is-empty'}`}
            title={gallery?.title}
          >
            {gallery ? gallery.title : '—'}
          </span>
        </div>
      </div>

      {/* 跨區互聯線索：從 Concepts 條目按鈕來的「這個 entity 的畫廊」 */}
      {related && (
        <RelatedClueCard
          block="uep-visland__related"
          kicker={<>與「{related.label ?? '這個'}」相關的影像</>}
          items={related.items}
          onSelect={(pageId) => navigateToZonePage('visuals', pageId)}
          onClose={() => setRelated(null)}
        />
      )}

      {suggestionCard}

      {/* ── 大圖舞台（左右箭頭）／空畫框 ── */}
      <div className="uep-visland__stage">
        {/* 清除投射：貼在畫框自己的角上。放島頭右端時與收合鈕僅差幾像素，
            會被讀成「收合」（艾斯維爾 2026-07-25 回饋）——關掉的是這張
            投影，按鈕就該長在投影上。 */}
        {gallery && (
          <button
            type="button"
            className="uep-visland__clear"
            onClick={clearProjection}
            onPointerDown={(e) => e.stopPropagation()}
            title="清除目前投射"
            aria-label="清除目前投射"
          >
            <span aria-hidden>×</span>
          </button>
        )}
        {projecting && items.length > 1 && (
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
          className={`uep-visland__frame${partial ? ' is-partial' : ''}${locked ? ' is-locked' : ''}${projecting ? '' : ' is-empty'}`}
        >
          {/* 換片光閃：key 變即重播（動畫掛在畫框本體會撞到常駐的
              flick 閃爍，兩者都吃 opacity），純裝飾層 */}
          <span
            key={`swap-${projectionKey}`}
            className="uep-visland__swap"
            aria-hidden
          />
          {!projecting ? (
            <p key={projectionKey} className="uep-visland__ghost">
              {ghost}
            </p>
          ) : locked ? (
            <LockedCell />
          ) : (
            <img
              key={projectionKey}
              src={imageUrl(current!.img.file)}
              alt={current!.img.caption || gallery!.title}
              draggable={false}
            />
          )}
        </div>
        {projecting && items.length > 1 && (
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
          {projecting
            ? `${String(safeIdx + 1).padStart(2, '0')} / ${String(items.length).padStart(2, '0')}`
            : '00 / 00'}
        </span>
        <span
          className={`uep-visland__caption-text${projecting ? '' : ' is-empty'}`}
        >
          {!projecting
            ? '尚無影像'
            : locked
              ? '？？？'
              : current!.img.caption || gallery!.title}
          {projecting && partial && (
            <em className="uep-visland__partial-tag">・尚未完全顯現</em>
          )}
        </span>
      </div>

      {/* ── 三態縮圖快切列 ──
          沒有投射時整列收掉：空格子只是把島撐大，並不會讓它更像裝置
          （艾斯維爾 2026-07-25，推翻設計稿的「縮圖格永遠在」） */}
      {projecting && (
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
      )}
    </div>
  );
}
