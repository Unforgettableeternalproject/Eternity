/**
 * Echoes 收藏池與 spoiler gate DevTools actions（Issue #41 驗收補強）
 *
 * 動機：`progress:grant-flags` 需要事先知道每首歌的旗標命名慣例
 *       （`{entityKey}:song` 或 `song:{songId}`），驗收 spoiler gate
 *       時反覆推導手動輸入太吃 memory。這一組 action 把命名慣例包起來，
 *       Test 環境快速切換歌曲的收藏狀態。
 *
 * 相關檔案：
 *   - audio/spoilerResolver.ts — deriveSongUnlockFlag、resolveSpoilerLevel
 *   - progress/progressStore.ts — grantFlags / revokeFlags bridge
 *
 * 註：spoiler 降級鏈的中間旗標（例如 `xavier:01`、`xavier:02`）由各歌
 *     的 revisions 資料決定，DevTools 無法通用化——仍需靠 admin editor
 *     看歌曲 revisions 再用 `progress:grant-flags` 授予。
 */

import { deriveSongUnlockFlag } from '../../audio/spoilerResolver';
import { getRegistry } from '../actionRegistry';

const GROUP = 'Echoes 收藏池';

/** 詢問使用者輸入 songId + entityKey（entityKey 可留空）。 */
function promptSongIdentity(): { songId: string; entityKey?: string } | null {
  const songId = window.prompt('輸入 songId（例：xavier-01）', '');
  if (!songId || !songId.trim()) return null;
  const entityKey = window.prompt(
    '輸入 entityKey（無則留空，用於角色歌 / 區域歌）',
    ''
  );
  return {
    songId: songId.trim(),
    entityKey: entityKey?.trim() || undefined,
  };
}

export function registerEchoesActions(): void {
  const registry = getRegistry();
  registry.register([
    {
      group: GROUP,
      id: 'echoes:grant-song-collected',
      label: '授予歌曲收藏（可加入佇列）',
      description:
        '輸入 songId + 可選 entityKey，自動推導 unlock flag 並授予進度',
      execute: () => {
        const identity = promptSongIdentity();
        if (!identity) return;
        const flag = deriveSongUnlockFlag(identity.songId, identity.entityKey);
        window.__uepProgress?.grantFlags([flag]);
        // eslint-disable-next-line no-console
        console.log(`[Echoes DevTools] 已授予收藏旗標: ${flag}`);
      },
    },
    {
      group: GROUP,
      id: 'echoes:relock-song-collected',
      label: '撤銷歌曲收藏（移出收藏池）',
      description: '輸入 songId + 可選 entityKey，推導 unlock flag 後撤銷',
      execute: () => {
        const identity = promptSongIdentity();
        if (!identity) return;
        const flag = deriveSongUnlockFlag(identity.songId, identity.entityKey);
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
        const flag = deriveSongUnlockFlag(identity.songId, identity.entityKey);
        // eslint-disable-next-line no-console
        console.log(
          `[Echoes DevTools] songId=${identity.songId}, entityKey=${identity.entityKey ?? '(none)'} → flag=${flag}`
        );
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
