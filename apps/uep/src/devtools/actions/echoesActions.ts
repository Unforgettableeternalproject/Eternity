/**
 * Echoes 收藏池與 spoiler gate DevTools actions（Issue #41 驗收補強）
 *
 * 動機：`progress:grant-flags` 需要事先知道每首歌的旗標命名慣例
 *       （劇情歌 `{storyKey}:song`、其餘 `{entityKey}:song`），驗收
 *       spoiler gate 時反覆推導手動輸入太吃 memory。這一組 action 把
 *       命名慣例包起來，Test 環境快速切換歌曲的收藏狀態。
 *
 * 相關檔案：
 *   - audio/spoilerResolver.ts — deriveSongUnlockFlag、resolveSpoilerLevel
 *   - progress/progressStore.ts — grantFlags / revokeFlags bridge
 *
 * 註：spoiler 降級鏈的中間旗標（例如 `xavier:01`、`xavier:02`）由各歌
 *     的 revisions 資料決定，DevTools 無法通用化——仍需靠 admin editor
 *     看歌曲 revisions 再用 `progress:grant-flags` 授予。
 *
 * 2026-08-03 起與 `flagActions` 併入同一個面板群組（`GROUPS.FLAGS`）：
 * 這四個 action 做的事就是「推導出旗標名再授予／撤銷」，與旗標群組是同一
 * 件事的兩種輸入方式（一個從註冊表選、一個從命名慣例推）。分成兩組只是
 * 因為它們寫在不同檔案。
 */

import { deriveSongUnlockFlag } from '../../audio/spoilerResolver';
import { getRegistry } from '../actionRegistry';
import { GROUPS } from '../groups';

const GROUP = GROUPS.FLAGS;
/** 三個寫／讀進度的 action 用；`derive-unlock-flag` 是純推導，不需要 */
const hasProgress = (): boolean =>
  typeof window !== 'undefined' && !!window.__uepProgress;

interface SongIdentity {
  songType: string;
  entityKey?: string;
  storyKey?: string;
}

/**
 * 詢問歌曲身分。分類決定要問哪一種 key——旗標推導對兩者的處理不同，
 * 問錯就會推出 `null`（無旗標）而不是使用者預期的字串。
 */
function promptSongIdentity(): SongIdentity | null {
  const songType = window.prompt(
    '輸入分類（story / character / area）',
    'character'
  );
  if (!songType || !songType.trim()) return null;
  const normalized = songType.trim();

  if (normalized === 'story') {
    const storyKey = window.prompt('輸入劇情點 key（例：rain-sea-finale）', '');
    return { songType: normalized, storyKey: storyKey?.trim() || undefined };
  }
  const entityKey = window.prompt('輸入 entityKey（例：xavier-colsono）', '');
  return { songType: normalized, entityKey: entityKey?.trim() || undefined };
}

/** 推導旗標；沒有 key 時提示並回傳 null（該歌永遠無法進收藏池）。 */
function deriveOrWarn(identity: SongIdentity): string | null {
  const flag = deriveSongUnlockFlag(
    identity.songType,
    identity.entityKey,
    identity.storyKey
  );
  if (!flag) {
    const field = identity.songType === 'story' ? '劇情點 key' : 'entityKey';
    // eslint-disable-next-line no-console
    console.warn(
      `[Echoes DevTools] 沒有${field}，這個組合推導不出收藏旗標——` +
        '該歌只能靠 Echo Spot 現場插播，不會進入收藏池'
    );
  }
  return flag;
}

export function registerEchoesActions(): void {
  const registry = getRegistry();
  registry.register([
    {
      group: GROUP,
      id: 'echoes:grant-song-collected',
      available: hasProgress,
      label: '授予歌曲收藏（可加入佇列）',
      description: '輸入分類 + 對應的 key，自動推導 unlock flag 並授予進度',
      execute: () => {
        const identity = promptSongIdentity();
        if (!identity) return;
        const flag = deriveOrWarn(identity);
        if (!flag) return;
        window.__uepProgress?.grantFlags([flag]);
        // eslint-disable-next-line no-console
        console.log(`[Echoes DevTools] 已授予收藏旗標: ${flag}`);
      },
    },
    {
      group: GROUP,
      id: 'echoes:relock-song-collected',
      available: hasProgress,
      label: '撤銷歌曲收藏（移出收藏池）',
      description: '輸入分類 + 對應的 key，推導 unlock flag 後撤銷',
      execute: () => {
        const identity = promptSongIdentity();
        if (!identity) return;
        const flag = deriveOrWarn(identity);
        if (!flag) return;
        window.__uepProgress?.revokeFlags([flag]);
        // eslint-disable-next-line no-console
        console.log(`[Echoes DevTools] 已撤銷收藏旗標: ${flag}`);
      },
    },
    {
      group: GROUP,
      id: 'echoes:derive-unlock-flag',
      label: '推導歌曲 unlock flag（不寫入，僅顯示 / 複製）',
      description: '純查詢：印出 deriveSongUnlockFlag 結果，並嘗試複製到剪貼簿',
      execute: async () => {
        const identity = promptSongIdentity();
        if (!identity) return;
        const flag = deriveOrWarn(identity);
        const key = identity.storyKey ?? identity.entityKey ?? '(none)';
        // eslint-disable-next-line no-console
        console.log(
          `[Echoes DevTools] songType=${identity.songType}, key=${key} → flag=${flag ?? '(無旗標)'}`
        );
        if (!flag) return;
        try {
          await navigator.clipboard.writeText(flag);
        } catch {
          /* 剪貼簿權限沒了就算了 */
        }
      },
    },
    {
      group: GROUP,
      id: 'echoes:dump-collected-flags',
      available: hasProgress,
      label: '傾印目前所有 song 相關旗標到 console',
      description: '過濾 progress.flags 內符合 `*:song` 或 `song:*` 的收藏旗標',
      execute: () => {
        const state = window.__uepProgress?.getState();
        if (!state) {
          // eslint-disable-next-line no-console
          console.warn('[Echoes DevTools] progress store 尚未就緒');
          return;
        }
        const songFlags = state.flags.filter(
          (f) => f.endsWith(':song') || f.startsWith('song:')
        );
        // eslint-disable-next-line no-console
        console.log('[Echoes DevTools] 目前收藏旗標:', songFlags);
        // eslint-disable-next-line no-console
        console.log(
          '[Echoes DevTools] 全部 flags（含 spoiler chain）:',
          state.flags
        );
      },
    },
  ]);
}
