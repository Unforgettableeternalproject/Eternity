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
  interacted: boolean;
  autoplayAttempted: boolean;
  resumeJump: boolean;
  scrollVelocity: number;
}

/** 劇情歌正常掃描必須嘗試插播；只有真正的跳轉誤觸才預先降級。 */
export function shouldDowngradeEchoSpot({
  isStory,
  spoilerLevel,
  resumeJump,
  scrollVelocity,
}: EchoSpotDowngradeInput): boolean {
  if (resumeJump || scrollVelocity > FAST_SCROLL_PX_PER_SECOND) return true;
  // 正常掃描一律實際嘗試插播；只有 L3 仍維持防劇透封印。
  return !isStory && spoilerLevel >= 3;
}

/**
 * History 掃描線的 Echo Spot 消費端。
 *
 * 不變量：授旗永遠無條件執行（不受島掛載、手勢、快速捲動與 resume
 * jump 限制），確保讀者尚未解鎖島時收藏進度仍會累積——但授旗必須
 * 等 by-id 反查落地後以**現行 entityKey** 進行（Admin 改綁後快照
 * entityKey 會授出對不上收藏判定的舊旗）；反查失敗才退回快照值。
 * 播放與提示卡另在反查落地後重驗島掛載——等待期間登出/停用 Echoes
 * 時不得再插播。
 */
export function useEchoSpots({
  pageId,
  progress,
  apiBase,
  resumeJumpRef,
  scrollVelocityRef,
}: UseEchoSpotsOptions) {
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const interactedRef = useRef(false);
  const triggeredRef = useRef(new Set<string>());
  const autoplayAttemptedRef = useRef(false);
  const visitTokenRef = useRef(0);
  const pendingRef = useRef<PendingEchoSpot | null>(null);

  const clearPending = useCallback(() => {
    pendingRef.current = null;
    setEchoSpotWaiting(false);
  }, []);

  const attemptInterrupt = useCallback((pending: PendingEchoSpot) => {
    if (visitTokenRef.current !== pending.visitToken) return;
    autoplayAttemptedRef.current = true;
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

  // 島展開是明確使用者手勢：消費收合期間暫存的 Echo Spot，這時才插播。
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
        attemptInterrupt(pending);
      }),
    [attemptInterrupt, clearPending]
  );

  useEffect(() => {
    const markInteracted = () => {
      interactedRef.current = true;
    };
    window.addEventListener('click', markInteracted, true);
    window.addEventListener('keydown', markInteracted, true);
    window.addEventListener('touchstart', markInteracted, true);
    return () => {
      window.removeEventListener('click', markInteracted, true);
      window.removeEventListener('keydown', markInteracted, true);
      window.removeEventListener('touchstart', markInteracted, true);
    };
  }, []);

  useEffect(() => {
    visitTokenRef.current += 1;
    clearPending();
    triggeredRef.current = new Set();
    autoplayAttemptedRef.current = false;
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

      if (triggeredRef.current.has(spot.spotId)) return;
      triggeredRef.current.add(spot.spotId);
      try {
        sessionStorage.setItem(visitStorageKey(pageId, spot.spotId), '1');
      } catch {
        // 隱私模式下 sessionStorage 可能不可寫；記憶體 Set 仍可去重。
      }

      // 誤觸判定輸入在觸發當下同步擷取——反查有網路延遲，
      // 事後再讀 scrollVelocity 會讓快速捲動的誤觸判定失真。
      const resumeJump = resumeJumpRef.current;
      const scrollVelocity = scrollVelocityRef.current;
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
        const shouldDowngrade = shouldDowngradeEchoSpot({
          isStory,
          spoilerLevel,
          interacted: interactedRef.current,
          autoplayAttempted: autoplayAttemptedRef.current,
          resumeJump,
          scrollVelocity,
        });
        if (shouldDowngrade) {
          clearPending();
          dispatchEchoPreview({ ...preview, justCollected: newlyUnlocked });
          return;
        }

        const pending: PendingEchoSpot = {
          effective,
          preview,
          accent: cluster.color,
          newlyUnlocked,
          visitToken,
        };
        // Echoes 島收合時不得偷播；只讓 dock chip 閃爍。使用者展開後
        // 由 runtime 訂閱同步消費，離開文章則由 page effect 直接丟棄。
        if (!getIslandRuntime().getWindow('echoes')?.open) {
          pendingRef.current = pending;
          setEchoSpotWaiting(true);
          return;
        }
        clearPending();
        attemptInterrupt(pending);
      });
    },
    [
      apiBase,
      attemptInterrupt,
      clearPending,
      pageId,
      resumeJumpRef,
      scrollVelocityRef,
    ]
  );
}
