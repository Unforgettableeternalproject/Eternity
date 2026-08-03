/**
 * 閱讀節奏與浮島教學的 DevTools actions（S10-4）
 *
 * 這三套機制的共同問題是**驗收成本高到不合理**：AFK 要等三分鐘、休息提醒要
 * 讀四十分鐘、教學一個帳號只演一次。它們要驗的都是視覺與手感（提示卡的
 * 版面與遮罩、聚光燈對不對得準），不是計時器準不準——那部分有 fake timers
 * 的單元測試顧著。
 *
 * 所以這裡提供的是「跳過門檻、走正規路徑」的入口：觸發之後的行為與真實
 * 情境完全一致。
 */

import { forceIdleNow, getActivityDebug } from '../../lib/activityWatch';
import { forceVeilStage, getVeilDebug } from '../../lib/idleVeil';
import { clearUepSettingsCache } from '../../lib/uepSettings';
import { getProgressManager } from '../../progress';
import { clearGuideSessionLimit } from '../../islands/guide/IslandGuideAuto';
import { requestGuideReplay } from '../../islands/guide/guideReplay';
import { shouldMountIsland } from '../../islands/islandRuntime';
import { getRegistry } from '../actionRegistry';
import { GROUPS } from '../groups';

/** `protectionActions` 的兩個 action 也掛這一組（同為 Reader 頁的行為層開關） */
const GROUP_RHYTHM = GROUPS.READER;
const GROUP_GUIDE = GROUPS.GUIDE;

const ISLAND_IDS = [
  'history',
  'concepts',
  'echoes',
  'visuals',
  'storage',
] as const;
type IslandId = (typeof ISLAND_IDS)[number];

const hasRestBridge = (): boolean =>
  typeof window !== 'undefined' && !!window.__uepRestReminderTest;

/** activityWatch 只在 Reader 頁面啟動（ReaderNudgeProvider 掛的） */
const isReaderPage = (): boolean =>
  typeof document !== 'undefined' &&
  document.body?.dataset?.readerPage === 'true';

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[DevTools] ${message}`);
}

export function registerRhythmActions(): void {
  const registry = getRegistry();

  registry.register([
    {
      group: GROUP_RHYTHM,
      id: 'rhythm:force-idle',
      label: '立刻進入閒置（帷幕開始生長）',
      description:
        '把最後活動時間推到閾值之外再跑一次判定——封存與恢復條件都與真實閒置一致。之後 20／60／120 秒依序進三個階段，想直接看某一階用下面的入口',
      available: isReaderPage,
      execute: () => {
        forceIdleNow();
        const debug = getActivityDebug();
        if (!debug.idle) {
          log(
            debug.started
              ? '已觸發，但狀態不是 idle——頁面可能不在前景（hidden／blur 時計時暫停）'
              : 'activityWatch 尚未啟動：這一頁不是 Reader'
          );
          return;
        }
        if (!debug.nudgeEnabled) {
          log('已進入閒置，但站台設定的「閒置提示」是不顯示，所以不會有帷幕');
        }
      },
    },
    ...([1, 2, 3] as const).map((stage) => ({
      group: GROUP_RHYTHM,
      id: `rhythm:veil-stage-${stage}`,
      label: `帷幕直接跳到階段 ${stage}`,
      description: [
        '邊緣起霧，動一下（80px）就散',
        '逼近中央，要劃一段（400px）才散',
        '全遮 + 「空曠~」，要繞幾圈（1200px）才散',
      ][stage - 1],
      available: isReaderPage,
      execute: () => {
        forceVeilStage(stage);
        const debug = getVeilDebug();
        if (debug.stage !== stage) {
          log(
            `已要求階段 ${stage}，但目前是 ${debug.stage}——` +
              '帷幕可能沒啟動（這一頁不是 Reader，或站台設定關掉了閒置提示）'
          );
        }
      },
    })),
    {
      group: GROUP_RHYTHM,
      id: 'rhythm:veil-status',
      label: '印出帷幕狀態',
      description:
        '階段、濃度、已累積／還需要多少驅散距離。`dispelPaused` 在面板開著時為 true——關掉面板才開始追蹤驅散',
      execute: () => {
        log(`idleVeil: ${JSON.stringify(getVeilDebug(), null, 2)}`);
      },
    },
    {
      group: GROUP_RHYTHM,
      id: 'rhythm:status',
      label: '印出目前的活動狀態',
      description:
        '閾值、累積活躍毫秒、距離上次動作多久、是否被 hidden／blur 暫停',
      execute: () => {
        const debug = getActivityDebug();
        log(
          `activityWatch: ${JSON.stringify(
            {
              ...debug,
              activeTotalSec: Math.round(debug.activeTotalMs / 1000),
              sinceActivitySec: Math.round(debug.msSinceActivity / 1000),
            },
            null,
            2
          )}`
        );
      },
    },
    {
      group: GROUP_RHYTHM,
      id: 'rhythm:apply-settings',
      label: '套用新的站台設定（重新載入頁面）',
      description:
        '清掉 settings 快取後重新載入。⚠️ 只重啟 activityWatch 是不夠的——AFK 提示的開關與休息提醒的 baseline 各自存在自己的元件裡，不會跟著重讀，那會讓驗收看到半套狀態',
      execute: () => {
        clearUepSettingsCache();
        window.location.reload();
      },
    },
    {
      group: GROUP_RHYTHM,
      id: 'rhythm:trigger-rest',
      label: '立刻跳出休息提醒',
      description:
        '走與正常判定相同的提交路徑，「知道了」的行為（重設 baseline + 開始冷卻）完全一致。只在 History Reader 可用',
      available: hasRestBridge,
      execute: () => {
        if (!window.__uepRestReminderTest) {
          log('休息提醒 bridge 未掛載——請在 History Reader 頁面使用');
          return;
        }
        window.__uepRestReminderTest.trigger();
      },
    },
    {
      group: GROUP_RHYTHM,
      id: 'rhythm:rest-status',
      label: '印出休息提醒的判定狀態',
      description: '本輪活躍時長、視窗內完成頁數、冷卻剩餘',
      available: hasRestBridge,
      execute: () => {
        if (!window.__uepRestReminderTest) {
          log('休息提醒 bridge 未掛載——請在 History Reader 頁面使用');
          return;
        }
        const state = window.__uepRestReminderTest.state();
        log(
          `休息提醒: ${JSON.stringify(
            {
              ...state,
              activeMin: (state.activeMs / 60000).toFixed(1),
              cooldownMin: (state.cooldownRemainingMs / 60000).toFixed(1),
            },
            null,
            2
          )}`
        );
      },
    },
  ]);

  // ── 浮島教學 ──

  registry.register([
    {
      group: GROUP_GUIDE,
      id: 'guide:clear-seen-all',
      label: '清除全部「已看過教學」',
      description:
        '五島都會重新符合自動播放條件（仍受每分頁一座的上限管，要連著看請一併清除 session 上限）',
      execute: () => {
        getProgressManager().clearIslandGuidesSeen();
        log('已清除；重新整理或換頁後會重新排程');
      },
    },
    {
      group: GROUP_GUIDE,
      id: 'guide:clear-session-limit',
      label: '解除本分頁的自動播放上限',
      description:
        '清掉 sessionStorage 的 uep-island-guide-auto-shown，不必開新分頁',
      execute: () => {
        clearGuideSessionLimit();
        log('已解除；下一次符合條件時會再自動播一座');
      },
    },
    ...ISLAND_IDS.flatMap((id: IslandId) => [
      {
        group: GROUP_GUIDE,
        id: `guide:play:${id}`,
        label: `播放 ${id} 島的教學`,
        description:
          '走回顧路徑：不受 session 上限與 seen 限制，也不會改寫 seen。島必須已解鎖且未停用',
        // 守門條件與 IslandGuideAuto 的 replay 分支完全一致——不合格時
        // 那邊會直接 return，按鈕按下去毫無反應。灰掉才看得出原因
        available: () => {
          const state = getProgressManager().getState();
          return shouldMountIsland(state, id);
        },
        execute: () => {
          requestGuideReplay(id);
        },
      },
      {
        group: GROUP_GUIDE,
        id: `guide:clear-seen:${id}`,
        label: `清除 ${id} 島的已看過紀錄`,
        execute: () => {
          getProgressManager().clearIslandGuidesSeen(id);
        },
      },
    ]),
  ]);
}
