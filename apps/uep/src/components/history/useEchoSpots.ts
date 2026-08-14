import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import {
  deriveSongUnlockFlag,
  getAudioStore,
  isSongCollected,
  resolveSpoilerLevel,
  type SongSpoilerRevision,
  type SpoilerLevel,
} from '../../audio';
import {
  getIslandRuntime,
  shouldMountIsland,
} from '../../islands/islandRuntime';
import {
  buildEchoAudioUrl,
  dispatchEchoPreview,
  echoClusterStyle,
  setEchoSpotWaiting,
  type EchoPreviewTrack,
} from '../../islands/echoes/echoPreview';
import { getProgressManager, type MarkerPassedInfo } from '../../progress';
import type { ProgressState } from '../../progress';

const FAST_SCROLL_PX_PER_SECOND = 1500;

interface UseEchoSpotsOptions {
  pageId: string | null;
  progress: ProgressState;
  apiBase: string;
  /** smooth resume jump 期間為 true；scrollend/timeout 後由呼叫端清除。 */
  resumeJumpRef: MutableRefObject<boolean>;
  /** 最近一次 scroll 計算出的速度絕對值。 */
  scrollVelocityRef: MutableRefObject<number>;
  /**
   * 迷霧線唯讀鏡像（0~1；未提供或 1 = 無保護）。決定誤觸的處置層級：
   * 保護生效中（< 1）誤觸＝事件不存在；無保護頁維持 S8 降級提示卡。
   */
  fogRatioRef?: MutableRefObject<number>;
}

interface EchoSpotData {
  spotId: string;
  songId: string;
  songUrlKey: string;
  entityKey: string | null;
  /** 劇情歌的劇情點身分（與 entityKey 依 songType 互斥） */
  storyKey: string | null;
  title: string;
  clusterId: string;
  songType: string;
  duration?: number;
  spoilerLevel: SpoilerLevel;
  spoilerRevisions: SongSpoilerRevision[];
}

interface PendingEchoSpot {
  effective: EchoSpotData;
  preview: EchoPreviewTrack;
  accent: string;
  newlyUnlocked: boolean;
  visitToken: number;
  /** 降級的 spot（L3 防劇透封印）：展開島後只補提示卡，不得補播。 */
  downgraded?: boolean;
}

function parseSpoilerLevel(value: string | null): SpoilerLevel {
  const parsed = Number(value);
  return parsed === 1 || parsed === 2 || parsed === 3 ? parsed : 0;
}

export function readEchoSpot(element: Element): EchoSpotData | null {
  const spotId = element.getAttribute('data-spot-id')?.trim() || '';
  const songId = element.getAttribute('data-song-id')?.trim() || '';
  const songUrlKey = element.getAttribute('data-song-url-key')?.trim() || '';
  if (!spotId || !songId || !songUrlKey) return null;

  let spoilerRevisions: SongSpoilerRevision[] = [];
  try {
    const parsed = JSON.parse(
      element.getAttribute('data-spoiler-revisions') || '[]'
    );
    if (Array.isArray(parsed)) spoilerRevisions = parsed;
  } catch {
    // 壞 snapshot 退回靜態 spoilerLevel，不讓文章掃描線中斷。
  }
  const duration = Number(element.getAttribute('data-duration'));
  const clusterId =
    element.getAttribute('data-cluster-id')?.trim() ||
    songId.split('/')[1] ||
    'special';
  return {
    spotId,
    songId,
    songUrlKey,
    entityKey: element.getAttribute('data-entity-key')?.trim() || null,
    storyKey: element.getAttribute('data-story-key')?.trim() || null,
    title: element.getAttribute('data-song-title')?.trim() || '未命名的回聲',
    clusterId,
    songType:
      element.getAttribute('data-song-type')?.trim() ||
      (clusterId === 'stories' ? 'story' : clusterId),
    ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
    spoilerLevel: parseSpoilerLevel(element.getAttribute('data-spoiler-level')),
    spoilerRevisions,
  };
}

function visitStorageKey(pageId: string, spotId: string): string {
  return `uep.echo-spot.triggered.${pageId}.${spotId}`;
}

/** `/api/echoes/song` 回傳的現行歌曲摘要（僅列快照刷新會用到的欄位） */
interface EchoSongRefreshPayload {
  audioFile?: unknown;
  title?: unknown;
  entityKey?: unknown;
  storyKey?: unknown;
  clusterId?: unknown;
  songType?: unknown;
  duration?: unknown;
  spoilerLevel?: unknown;
  spoilerRevisions?: unknown;
}

/**
 * 以 songId 反查現行歌曲資料，刷新過期快照。
 *
 * 文章 node 的 songUrlKey/title/spoilerRevisions 是編輯器插入當下的
 * 快照——歌曲換音檔或改 spoiler 後即過期，D1 才是真相。反查失敗
 * （離線/端點錯誤）或歌曲已無音檔時退回快照，行為不劣於反查前。
 */
export async function refreshEchoSpot(
  apiBase: string,
  spot: EchoSpotData
): Promise<EchoSpotData> {
  try {
    const res = await fetch(
      `${apiBase}/api/echoes/song?id=${encodeURIComponent(spot.songId)}`
    );
    if (!res.ok) return spot;
    const json = (await res.json()) as {
      ok: boolean;
      data?: { found: boolean; song?: EchoSongRefreshPayload };
    };
    const song = json.ok && json.data?.found ? json.data.song : null;
    if (!song || typeof song.audioFile !== 'string' || !song.audioFile) {
      return spot;
    }
    const level = song.spoilerLevel;
    return {
      ...spot,
      songUrlKey: song.audioFile,
      // entityKey 以現行資料為準——授旗必須用現行值，否則 Admin 改綁
      // entityKey 後會授出對不上收藏判定的舊旗（假成功）；API 回 null
      // 代表現已無綁定，同樣以現行為準
      entityKey:
        typeof song.entityKey === 'string' && song.entityKey.trim()
          ? song.entityKey
          : null,
      // storyKey 同理以現行資料為準（劇情歌的授旗依據）
      storyKey:
        typeof song.storyKey === 'string' && song.storyKey.trim()
          ? song.storyKey
          : null,
      title:
        typeof song.title === 'string' && song.title ? song.title : spot.title,
      clusterId:
        typeof song.clusterId === 'string' && song.clusterId
          ? song.clusterId
          : spot.clusterId,
      songType:
        typeof song.songType === 'string' && song.songType
          ? song.songType
          : spot.songType,
      ...(typeof song.duration === 'number' && song.duration > 0
        ? { duration: song.duration }
        : {}),
      // spoiler 欄位以現行資料為準——快照過期會誤判防劇透 gate，
      // 這裡不 fallback（端點永遠回傳 spoilerLevel；revisions 空即無降級鏈）
      spoilerLevel: level === 1 || level === 2 || level === 3 ? level : 0,
      spoilerRevisions: Array.isArray(song.spoilerRevisions)
        ? (song.spoilerRevisions as SongSpoilerRevision[])
        : [],
    };
  } catch {
    return spot;
  }
}

interface EchoSpotDowngradeInput {
  isStory: boolean;
  spoilerLevel: SpoilerLevel;
}

/**
 * 誤觸判定：resume jump（系統代捲）或快速捲動掃過的 spot。
 *
 * 處置分兩級（2026-07-29 定案，由呼叫端依 fogRatio 分流）：
 * - rush protection 生效中（迷霧未散盡）：事件視為不存在——不去重、
 *   不授旗、不留等待 chip，回捲正常速度再過照常觸發。舊行為的降級
 *   提示卡在 rush 測試時看起來像遮蔽失效。
 * - 無保護頁（已讀完／非迷霧頁）：rush 本來就合法，維持 S8 的誤觸
 *   降級——照常去重與授旗，插播降為提示卡（手動播放入口）。
 */
export function isEchoSpotMisfire(
  resumeJump: boolean,
  scrollVelocity: number
): boolean {
  return resumeJump || scrollVelocity > FAST_SCROLL_PX_PER_SECOND;
}

/** 插播前降級：只剩 L3 防劇透封印（誤觸已在事件入口整個略過）。 */
export function shouldDowngradeEchoSpot({
  isStory,
  spoilerLevel,
}: EchoSpotDowngradeInput): boolean {
  return !isStory && spoilerLevel >= 3;
}

/**
 * History 掃描線的 Echo Spot 消費端。
 *
 * 不變量：事件成立後授旗無條件執行（不受島掛載限制），確保讀者尚未
 * 解鎖島時收藏進度仍會累積——但授旗必須等 by-id 反查落地後以**現行
 * entityKey** 進行（Admin 改綁後快照 entityKey 會授出對不上收藏判定
 * 的舊旗）；反查失敗才退回快照值。
 * 誤觸（rush／resume jump）在 rush protection 生效中的頁面整個事件
 * 不成立（見 isEchoSpotMisfire）——遮蔽語意優先於收藏累積，正常速度
 * 再經過時才觸發、才授旗；無保護頁維持 S8 誤觸降級（授旗照常）。
 * 播放與提示卡另在反查落地後重驗島掛載——等待期間登出/停用 Echoes
 * 時不得再插播。
 */
export function useEchoSpots({
  pageId,
  progress,
  apiBase,
  resumeJumpRef,
  scrollVelocityRef,
  fogRatioRef,
}: UseEchoSpotsOptions) {
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const triggeredRef = useRef(new Set<string>());
  const visitTokenRef = useRef(0);
  const pendingRef = useRef<PendingEchoSpot | null>(null);

  const clearPending = useCallback(() => {
    pendingRef.current = null;
    setEchoSpotWaiting(false);
  }, []);

  const attemptInterrupt = useCallback((pending: PendingEchoSpot) => {
    if (visitTokenRef.current !== pending.visitToken) return;
    void getAudioStore()
      .interrupt(
        pending.effective.songId,
        pending.preview.url,
        pending.effective.title,
        pending.accent
      )
      .then((played) => {
        if (visitTokenRef.current !== pending.visitToken) return;
        dispatchEchoPreview({
          ...pending.preview,
          ...(played ? { source: 'played' as const } : {}),
          justCollected: pending.newlyUnlocked,
        });
      });
  }, []);

  const emitSpotCard = useCallback((pending: PendingEchoSpot) => {
    if (visitTokenRef.current !== pending.visitToken) return;
    dispatchEchoPreview({
      ...pending.preview,
      justCollected: pending.newlyUnlocked,
    });
  }, []);

  // 島展開是明確使用者手勢：消費收合期間暫存的 Echo Spot，這時才插播
  // 或補發提示卡（降級的 spot 本來就不該播）。
  useEffect(
    () =>
      getIslandRuntime().subscribe((state, detail) => {
        if (detail.source === 'reset') {
          clearPending();
          return;
        }
        if (!state.windows.echoes?.open || !pendingRef.current) return;
        const pending = pendingRef.current;
        clearPending();
        if (pending.downgraded) emitSpotCard(pending);
        else attemptInterrupt(pending);
      }),
    [attemptInterrupt, clearPending, emitSpotCard]
  );

  useEffect(() => {
    visitTokenRef.current += 1;
    clearPending();
    triggeredRef.current = new Set();
    if (pageId) {
      const prefix = `uep.echo-spot.triggered.${pageId}.`;
      for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = sessionStorage.key(index);
        if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
      }
    }
    return () => {
      clearPending();
      // 離開文章是插播恢復條件；一般播放狀態不受影響。
      if (getAudioStore().getState().interruptionSnapshot) {
        getAudioStore().restoreFromInterruption();
      }
    };
  }, [clearPending, pageId]);

  // 登出、停用或失去探索者資格時，等待事件不可跨守門殘留。
  useEffect(() => {
    if (!shouldMountIsland(progress, 'echoes')) clearPending();
  }, [clearPending, progress]);

  return useCallback(
    (info: MarkerPassedInfo) => {
      if (info.role !== 'echo-spot' || !pageId) return;
      const spot = readEchoSpot(info.element);
      if (!spot) return;

      // 誤觸判定輸入在觸發當下同步擷取——反查有網路延遲，事後再讀
      // scrollVelocity 會讓快速捲動的誤觸判定失真
      const misfire = isEchoSpotMisfire(
        resumeJumpRef.current,
        scrollVelocityRef.current
      );
      // rush protection 生效中的誤觸 = 事件不存在：在去重**之前**擋掉，
      // 痕跡一律不留——記進去重集合的話，回捲重讀時 spot 就永遠不會
      // 再響。無保護頁（迷霧散盡/已讀完/非迷霧頁）繼續往下走降級路徑
      if (misfire && (fogRatioRef?.current ?? 1) < 1) return;

      if (triggeredRef.current.has(spot.spotId)) return;
      triggeredRef.current.add(spot.spotId);
      try {
        sessionStorage.setItem(visitStorageKey(pageId, spot.spotId), '1');
      } catch {
        // 隱私模式下 sessionStorage 可能不可寫；記憶體 Set 仍可去重。
      }

      const visitToken = visitTokenRef.current;

      void refreshEchoSpot(apiBase, spot).then((effective) => {
        // 授旗以反查後的**現行 key** 進行（反查失敗 effective 退回快照，
        // 行為不劣於前）；不受島掛載、visitToken 限制——通過 spot 即算
        // 收藏，離頁也不取消。
        //
        // 沒有 key 的歌推導不出旗標：仍照常插播，只是不進收藏池，
        // 且每次都算「首次」（沒有旗標可以記住聽過）。
        const unlockFlag = deriveSongUnlockFlag(
          effective.songType,
          effective.entityKey,
          effective.storyKey
        );
        const newlyUnlocked = unlockFlag
          ? !isSongCollected(unlockFlag, progressRef.current)
          : true;
        if (unlockFlag) getProgressManager().grantFlags([unlockFlag]);

        if (visitTokenRef.current !== visitToken) return;
        // 反查落地後重驗島掛載——等待期間登出/停用 Echoes 時，audio
        // 已被 stop()，此時再 interrupt 等於復活播放
        if (!shouldMountIsland(progressRef.current, 'echoes')) return;

        const isStory =
          effective.songType === 'story' || effective.clusterId === 'stories';
        // 劇情歌與劇情 CG 同語意：Echo Spot 就是其解鎖與首次呈現入口，
        // 不再套一般歌曲的 spoiler 分級。
        const spoilerLevel = isStory
          ? 0
          : resolveSpoilerLevel(
              effective.spoilerRevisions,
              progressRef.current
            );
        const cluster = echoClusterStyle(effective.clusterId);
        const preview = {
          source: 'spot' as const,
          songId: effective.songId,
          title: effective.title,
          url: buildEchoAudioUrl(apiBase, effective.songUrlKey),
          clusterId: effective.clusterId,
          ...(effective.duration ? { duration: effective.duration } : {}),
          spoilerLevel,
          accent: cluster.color,
        };

        // Echo Spot 的主要行為是插播；提示卡等插播結果確定後才發——
        // 成功只告知（無動作按鈕），降級/失敗才給手動播放入口。
        // 本次新收藏以 justCollected 併入同一張卡，不另發 unlock 卡。
        const shouldDowngrade =
          misfire || shouldDowngradeEchoSpot({ isStory, spoilerLevel });
        const pending: PendingEchoSpot = {
          effective,
          preview,
          accent: cluster.color,
          newlyUnlocked,
          visitToken,
          ...(shouldDowngrade ? { downgraded: true } : {}),
        };
        // Echoes 島收合時不得偷播，也不該讓提示卡在島外自己冒出來
        // ——兩條路徑一律先進 dock chip 等待。使用者展開後由 runtime
        // 訂閱同步消費，離開文章則由 page effect 直接丟棄。
        if (!getIslandRuntime().getWindow('echoes')?.open) {
          pendingRef.current = pending;
          setEchoSpotWaiting(true);
          return;
        }
        clearPending();
        if (shouldDowngrade) emitSpotCard(pending);
        else attemptInterrupt(pending);
      });
    },
    [
      apiBase,
      attemptInterrupt,
      clearPending,
      emitSpotCard,
      fogRatioRef,
      pageId,
      resumeJumpRef,
      scrollVelocityRef,
    ]
  );
}
