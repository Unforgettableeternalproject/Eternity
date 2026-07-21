/* global AbortController */
/**
 * UEP 浮島系統 — 全域掛載點
 *
 * 掛在 TopBar（覆蓋所有非 admin 頁面），但用 createPortal 逃出 TopBar 的
 * sticky z-100 堆疊上下文（S5 教訓：內部 fixed 元件 z-index 對外被鎖 100 層），
 * 讓浮島的 2000-2999 層帶真正生效於 Minimap（300）之上。
 *
 * 掛載守門（四關）：
 * 1. 探索者視角（觀測者/切換中沒有浮島——需求定案）
 * 2. 已解鎖（ProgressState.islandsUnlocked，zone 首頁小物件授予）
 * 3. 未被使用者停用（識別證設定視窗寫入）
 * 4. 已有實體元件（S6 只有 history；S7/S8 逐島補上）
 */

import React, {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { useReaderAuth } from '../auth';
import { UEP_ENTITY_ACTIVATE_EVENT } from '../embed';
import type { EntityActivateDetail } from '../embed';
import { useProgress } from '../progress';
import { resolveSpoilerLevel } from '../audio';
import { isSongUnlockedInZone } from '../components/echoes/echoesVisibility';
import { isGalleryUnlockedInZone } from '../components/visuals/visualsVisibility';

import DraggableIsland from './DraggableIsland';
import IslandDock from './IslandDock';
import { pushEntityActivate } from './concepts/terminalBridge';
import {
  canUseIslands,
  getIslandRuntime,
  shouldMountIsland,
} from './islandRuntime';
import { mountIslandsTestBridge } from './testBridge';
import { ISLAND_IDS } from './types';
import type { IslandId } from './types';
import { useDesktopIslandViewport, useIslandRuntimeState } from './useIslands';
import SongPreviewCard from './echoes/SongPreviewCard';
import {
  clearPhantomSuggestion,
  isPhantomSuggestionEligible,
  parsePhantomImages,
  pushPhantomSuggestion,
} from './visuals/phantomBridge';
import {
  clearEchoSuggestion,
  isEchoSuggestionEligible,
  pushEchoSuggestion,
} from './echoes/echoSuggestionBridge';
import { fetchZoneProgressTree } from './zoneProgressTree';
import {
  UEP_ECHO_PREVIEW_EVENT,
  buildEchoAudioUrl,
  echoClusterStyle,
  type EchoPreviewTrack,
} from './echoes/echoPreview';
import { getApiBase } from '../lib/apiBase';

const API_BASE = getApiBase();

/**
 * 各島的實體內容元件註冊表（lazy——TopBar 全站掛載，島內容只在
 * 真正展開時載入，避免 tree 抓取等邏輯進到每一頁的初始 bundle）。
 * S6：history；S7：concepts；S8：echoes；S8 後半：visuals；S9：storage。
 */
const ISLAND_COMPONENTS: Partial<
  Record<IslandId, React.LazyExoticComponent<React.ComponentType>>
> = {
  history: React.lazy(() => import('./history/HistoryIsland')),
  concepts: React.lazy(() => import('./concepts/TerminalIsland')),
  echoes: React.lazy(() => import('./echoes/EchoesIsland')),
  visuals: React.lazy(() => import('./visuals/VisualsIsland')),
};

export default function IslandHost() {
  const progress = useProgress();
  // 訂閱 auth 變化（S7-C 定案：浮島限已登入探索者）——登入/登出時
  // 重新求值守門；canUseIslands 內部讀 auth singleton，此 hook 純為重渲染
  useReaderAuth();
  // resize／裝置旋轉即時重渲染——canUseIslands 內部的桌面寬度判定只在
  // 呼叫當下同步讀值，不會自己觸發重渲染（S8 手動驗收 #9 追加修復）
  const desktopViewport = useDesktopIslandViewport();
  const runtimeState = useIslandRuntimeState();
  const [mounted, setMounted] = useState(false);
  const [echoPreview, setEchoPreview] = useState<EchoPreviewTrack | null>(null);
  /** 事件 listener 取用最新進度（不重綁） */
  const progressRef = useRef(progress);
  progressRef.current = progress;

  useEffect(() => setMounted(true), []);

  // dev 測試 bridge（S6-3）：全站可用的浮島解鎖/足跡操控入口。
  // 掛在這裡而非各 Reader——解鎖狀態是全域的，不該綁定單一 zone。
  useEffect(() => mountIslandsTestBridge(), []);

  // entity-activate 常駐監聽（S7-C）：監聽必須放在 Host 而非
  // TerminalIsland——島收合時內容元件沒有 mount，聽不到事件。
  // 收到後暫存 detail（terminalBridge）並展開島，島 mount 後取走。
  // concepts 島不可用（未解鎖/停用/觀測者）→ 事件靜默消失（既有定案）。
  useEffect(() => {
    const onActivate = (event: Event) => {
      const detail = (event as CustomEvent<EntityActivateDetail>).detail;
      if (!detail) return;
      if (!shouldMountIsland(progressRef.current, 'concepts')) return;
      pushEntityActivate(detail);
      getIslandRuntime().open('concepts');
    };
    window.addEventListener(UEP_ENTITY_ACTIVATE_EVENT, onActivate);
    return () =>
      window.removeEventListener(UEP_ENTITY_ACTIVATE_EVENT, onActivate);
  }, []);

  // 右下角卡承接 Echo Spot 結果通知：插播成功（played，純告知）、
  // 等待播放（spot，帶手動入口）或非 Spot 解鎖（unlock）。
  useEffect(() => {
    const onPreview = (event: Event) => {
      const detail = (event as CustomEvent<EchoPreviewTrack>).detail;
      if (!detail) return;
      if (detail.source === 'embed') return;
      if (!shouldMountIsland(progressRef.current, 'echoes')) return;
      setEchoPreview(detail);
    };
    window.addEventListener(UEP_ECHO_PREVIEW_EVENT, onPreview);
    return () => window.removeEventListener(UEP_ECHO_PREVIEW_EVENT, onPreview);
  }, []);

  // entity-activate 的 Echoes 消費：只把「已收藏、非劇情歌、L0」的對應曲
  // 推進流浪回聲島內提示；不授旗、不打斷目前播放。
  // AbortController 防止快速點擊不同 entity 時舊回應覆蓋新卡。
  // 解鎖判定搭配 zone tree（fetchZoneProgressTree）走 tree-aware gate
  // ——父容器 gate/progressPage 鏈生效；tree 取不到時 fail-closed。
  useEffect(() => {
    let controller: AbortController | null = null;
    const onActivate = (event: Event) => {
      const detail = (event as CustomEvent<EntityActivateDetail>).detail;
      if (!detail?.entityKey) return;
      if (!shouldMountIsland(progressRef.current, 'echoes')) return;
      controller?.abort();
      controller = new AbortController();
      void Promise.all([
        fetch(
          `${API_BASE}/api/echoes/entity-song?key=${encodeURIComponent(detail.entityKey)}`,
          { signal: controller.signal }
        ).then((response) => response.json()),
        fetchZoneProgressTree('echoes'),
      ])
        .then(([payload, zoneTree]) => {
          // async 落地後重驗——等待期間可能登出/停用 Echoes，此時不得
          // 再推提示或展開島
          if (!shouldMountIsland(progressRef.current, 'echoes')) return;
          const song = payload?.data?.song;
          // 查不到／不合格時清掉舊提示卡——否則上一張 RELATED ECHO
          // 會殘留，誤導使用者以為與這次點擊的 entity 有關
          if (!payload?.ok || !song) {
            clearEchoSuggestion();
            return;
          }
          const progressNow = progressRef.current;
          const unlocked = isSongUnlockedInZone(
            {
              id: song.id,
              metadata: {
                entityKey: song.entityKey,
                gate: song.gate,
                locked: song.locked,
              },
            },
            progressNow,
            zoneTree
          );
          const revisions = Array.isArray(song.spoilerRevisions)
            ? song.spoilerRevisions
            : [];
          const spoilerLevel = resolveSpoilerLevel(revisions, progressNow);
          if (
            !isEchoSuggestionEligible({
              songType: song.songType,
              unlocked,
              spoilerLevel,
              audioFile: song.audioFile,
            })
          ) {
            clearEchoSuggestion();
            return;
          }
          const cluster = echoClusterStyle(song.clusterId || song.songType);
          pushEchoSuggestion({
            source: 'embed',
            songId: song.id,
            title: song.title,
            url: buildEchoAudioUrl(API_BASE, song.audioFile),
            clusterId: song.clusterId || song.songType || 'special',
            ...(song.duration ? { duration: song.duration } : {}),
            spoilerLevel: 0,
            accent: cluster.color,
          });
          getIslandRuntime().open('echoes');
        })
        .catch((error: unknown) => {
          if ((error as { name?: string }).name !== 'AbortError') {
            // 對使用者靜默；entity 本身仍由 Terminal 正常處理。
            // 反查失敗同樣清掉舊提示卡，避免殘留誤導。
            clearEchoSuggestion();
          }
        });
    };
    window.addEventListener(UEP_ENTITY_ACTIVATE_EVENT, onActivate);
    return () => {
      controller?.abort();
      window.removeEventListener(UEP_ENTITY_ACTIVATE_EVENT, onActivate);
    };
  }, []);

  // entity-activate 的 Visuals 消費（V-C）：以 entityKey 反查陳列走廊
  // gallery，只把「進島分館 + 已解鎖 + 有圖片」者推進浮動幻影島內提示卡
  // ——提示為主，按「展示」才切換投射（比照 Echoes 嵌入提示，不直接展示）。
  // AbortController 防止快速點擊不同 entity 時舊回應覆蓋新卡。
  // gallery 閘搭配 zone tree（fetchZoneProgressTree）走 tree-aware 求值
  // ——容器繼承生效；tree 取不到時 fail-closed。
  useEffect(() => {
    let controller: AbortController | null = null;
    const onActivate = (event: Event) => {
      const detail = (event as CustomEvent<EntityActivateDetail>).detail;
      if (!detail?.entityKey) return;
      if (!shouldMountIsland(progressRef.current, 'visuals')) return;
      controller?.abort();
      controller = new AbortController();
      void Promise.all([
        fetch(
          `${API_BASE}/api/visuals/entity-gallery?key=${encodeURIComponent(detail.entityKey)}`,
          { signal: controller.signal }
        ).then((response) => response.json()),
        fetchZoneProgressTree('visuals'),
      ])
        .then(([payload, zoneTree]) => {
          // async 落地後重驗——等待期間可能登出/停用 Visuals
          if (!shouldMountIsland(progressRef.current, 'visuals')) return;
          const gallery = payload?.data?.gallery;
          // 查不到／不合格時清掉舊提示卡——否則上一張 RELATED VISUAL
          // 會殘留，誤導使用者以為與這次點擊的 entity 有關
          if (!payload?.ok || !gallery) {
            clearPhantomSuggestion();
            return;
          }
          // 推導旗標（clue 展示授旗）可解鎖，static locked 仍優先
          const unlocked = isGalleryUnlockedInZone(
            {
              id: gallery.id,
              metadata: {
                entityKey: gallery.entityKey ?? null,
                gate: gallery.gate,
                locked: gallery.locked,
              },
            },
            progressRef.current,
            zoneTree
          );
          // worker 回摘要欄位 → PhantomImage（V-D 起與 Visual Clue 共用）
          const images = parsePhantomImages(gallery.images);
          if (
            !isPhantomSuggestionEligible({
              divisionId: gallery.divisionId,
              unlocked,
              imageCount: images.length,
            })
          ) {
            clearPhantomSuggestion();
            return;
          }
          pushPhantomSuggestion({
            id: gallery.id,
            title: gallery.title,
            entityKey: gallery.entityKey ?? null,
            divisionId: gallery.divisionId ?? null,
            // gallery 閘快照——島依 progress 變化重驗（pristineOnly 可失效）
            gate: gallery.gate ?? null,
            locked: gallery.locked === true,
            images,
            source: 'embed',
          });
          getIslandRuntime().open('visuals');
        })
        .catch((error: unknown) => {
          if ((error as { name?: string }).name !== 'AbortError') {
            // 對使用者靜默；entity 本身仍由 Terminal 正常處理。
            // 反查失敗同樣清掉舊提示卡，避免殘留誤導。
            clearPhantomSuggestion();
          }
        });
    };
    window.addEventListener(UEP_ENTITY_ACTIVATE_EVENT, onActivate);
    return () => {
      controller?.abort();
      window.removeEventListener(UEP_ENTITY_ACTIVATE_EVENT, onActivate);
    };
  }, []);

  const dismissEchoPreview = useCallback(() => setEchoPreview(null), []);

  // SSR / 首次 render 前不輸出（portal 需要 document）
  if (!mounted) return null;

  // 守門 1：只有探索者有浮島（+ 桌面視窗，即時反映 resize/旋轉）
  if (!desktopViewport || !canUseIslands(progress)) return null;

  // 守門 2 + 3 + 4：已解鎖、未停用、且有實體元件
  const activeIds = ISLAND_IDS.filter(
    (id) => shouldMountIsland(progress, id) && ISLAND_COMPONENTS[id]
  );
  if (activeIds.length === 0) return null;

  const openIds = activeIds.filter((id) => runtimeState.windows[id]?.open);

  return createPortal(
    <>
      <IslandDock unlockedIds={activeIds} />
      {/* 通知卡限定 Echoes 島可用——事件落地後 Echoes 被停用時不得殘留 */}
      {echoPreview && shouldMountIsland(progress, 'echoes') && (
        <SongPreviewCard track={echoPreview} onDismiss={dismissEchoPreview} />
      )}
      {openIds.map((id) => {
        const Body = ISLAND_COMPONENTS[id]!;
        return (
          <DraggableIsland key={id} id={id} className={`uep-island--${id}`}>
            <Suspense fallback={null}>
              <Body />
            </Suspense>
          </DraggableIsland>
        );
      })}
    </>,
    document.body
  );
}
