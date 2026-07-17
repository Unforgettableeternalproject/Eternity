import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import {
  deriveSongUnlockFlag,
  getAudioStore,
  isSongCollected,
  resolveSpoilerLevel,
  type SongSpoilerRevision,
  type SpoilerLevel,
} from '../../audio';
import { shouldMountIsland } from '../../islands/islandRuntime';
import {
  buildEchoAudioUrl,
  dispatchEchoPreview,
  echoClusterStyle,
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
  title: string;
  clusterId: string;
  songType: string;
  duration?: number;
  spoilerLevel: SpoilerLevel;
  spoilerRevisions: SongSpoilerRevision[];
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
 * 不變量：授旗永遠先做；播放與提示卡才受島掛載、手勢、快速捲動與
 * resume jump 限制。這確保讀者尚未解鎖島時，收藏進度仍會累積。
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
      // 離開文章是插播恢復條件；一般播放狀態不受影響。
      if (getAudioStore().getState().interruptionSnapshot) {
        getAudioStore().restoreFromInterruption();
      }
    };
  }, [pageId]);

  return useCallback(
    (info: MarkerPassedInfo) => {
      if (info.role !== 'echo-spot' || !pageId) return;
      const spot = readEchoSpot(info.element);
      if (!spot) return;

      const progressNow = progressRef.current;
      const unlockFlag = deriveSongUnlockFlag(spot.songId, spot.entityKey);
      const newlyUnlocked = !isSongCollected(unlockFlag, progressNow);
      // 收藏旗標不受島掛載或 autoplay 限制。
      getProgressManager().grantFlags([unlockFlag]);

      if (triggeredRef.current.has(spot.spotId)) return;
      triggeredRef.current.add(spot.spotId);
      try {
        sessionStorage.setItem(visitStorageKey(pageId, spot.spotId), '1');
      } catch {
        // 隱私模式下 sessionStorage 可能不可寫；記憶體 Set 仍可去重。
      }

      if (!shouldMountIsland(progressNow, 'echoes')) return;

      const isStory = spot.songType === 'story' || spot.clusterId === 'stories';
      // 劇情歌與劇情 CG 同語意：Echo Spot 就是其解鎖與首次呈現入口，
      // 不再套一般歌曲的 spoiler 分級。
      const spoilerLevel = isStory
        ? 0
        : resolveSpoilerLevel(spot.spoilerRevisions, progressNow);
      const cluster = echoClusterStyle(spot.clusterId);
      const preview = {
        source: 'spot' as const,
        songId: spot.songId,
        title: spot.title,
        url: buildEchoAudioUrl(apiBase, spot.songUrlKey),
        clusterId: spot.clusterId,
        ...(spot.duration ? { duration: spot.duration } : {}),
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
        resumeJump: resumeJumpRef.current,
        scrollVelocity: scrollVelocityRef.current,
      });
      if (shouldDowngrade) {
        dispatchEchoPreview({ ...preview, justCollected: newlyUnlocked });
        return;
      }

      autoplayAttemptedRef.current = true;
      const visitToken = visitTokenRef.current;
      void getAudioStore()
        .interrupt(spot.songId, preview.url, spot.title, cluster.color)
        .then((played) => {
          if (visitTokenRef.current !== visitToken) return;
          dispatchEchoPreview({
            ...preview,
            ...(played ? { source: 'played' as const } : {}),
            justCollected: newlyUnlocked,
          });
        });
    },
    [apiBase, pageId, resumeJumpRef, scrollVelocityRef]
  );
}
