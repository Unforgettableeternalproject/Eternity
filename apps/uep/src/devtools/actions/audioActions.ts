/**
 * 音訊 DevTools actions（Issue #41 T-20）
 *
 * 依賴 `window.__uepAudio`（audioStore 掛的 bridge，非 dev-only）。
 * 只在 EchoesReader / 有 AudioProvider 的頁面有音訊上下文；
 * 沒上下文時 available() 仍然 true（bridge 存在），操作會 no-op 但不 crash。
 */

import { AUDIO_STORAGE_KEY } from '../../audio/audioTypes';
import { getRegistry } from '../actionRegistry';
import { GROUPS } from '../groups';

const GROUP = GROUPS.AUDIO;

const hasBridge = (): boolean =>
  typeof window !== 'undefined' && !!window.__uepAudio;

function warn(): void {
  // eslint-disable-next-line no-console
  console.warn('[DevTools] __uepAudio 尚未掛載（頁面未載入 audioStore）');
}

/** 從 window.__uepAudio 讀 state 快照（如果 bridge 有 getState） */
function readState(): unknown {
  const bridge = window.__uepAudio as unknown as { getState?: () => unknown };
  return bridge?.getState?.() ?? null;
}

export function registerAudioActions(): void {
  getRegistry().register([
    {
      group: GROUP,
      id: 'audio:pause',
      label: '暫停播放',
      available: hasBridge,
      execute: () => {
        if (!window.__uepAudio) return warn();
        window.__uepAudio.pause();
      },
    },
    {
      group: GROUP,
      id: 'audio:stop',
      label: '停止播放（清 currentSong）',
      available: hasBridge,
      execute: () => {
        if (!window.__uepAudio) return warn();
        window.__uepAudio.stop();
      },
    },
    {
      group: GROUP,
      id: 'audio:restore-interruption',
      label: '從插播還原（restoreFromInterruption）',
      description: '模擬 UI 對話結束後恢復原曲',
      available: hasBridge,
      execute: () => {
        if (!window.__uepAudio) return warn();
        window.__uepAudio.restoreFromInterruption();
      },
    },
    {
      group: GROUP,
      id: 'audio:dump-state',
      label: '傾印音訊狀態到 console',
      available: hasBridge,
      execute: () => {
        // eslint-disable-next-line no-console
        console.log('[UEP Audio State]', readState());
      },
    },
    {
      group: GROUP,
      id: 'audio:wipe-persistence',
      label: '清除音訊持久化（不重載）',
      description: '停止播放並刪 uep.audio.v1 localStorage',
      destructive: true,
      execute: () => {
        // 必須先 stop：播放中的 audioStore 會週期性 persistSnapshot()，
        // 只刪 key 的話下一次快照就把它原樣寫回去，看起來像沒清成功。
        window.__uepAudio?.stop();
        try {
          localStorage.removeItem(AUDIO_STORAGE_KEY);
        } catch {
          /* 忽略 */
        }
      },
    },
  ]);
}
