/**
 * 閱讀節奏與浮島教學的 DevTools actions（S10-4）
 *
 * 這三套機制的共同問題是**驗收成本高到不合理**：AFK 要等三分鐘、休息提醒要
 * 讀四十分鐘、教學只在解鎖儀式收束時演。它們要驗的都是視覺與手感（提示卡的
 * 版面與遮罩、聚光燈對不對得準），不是計時器準不準——那部分有 fake timers
 * 的單元測試顧著。
 *
 * 所以這裡提供的是「跳過門檻、走正規路徑」的入口：觸發之後的行為與真實
 * 情境完全一致。
 */

import { forceIdleNow, getActivityDebug } from '../../lib/activityWatch';
import { forceVeilStage, getVeilDebug } from '../../lib/idleVeil';
import { markTeatimeInvited } from '../../lib/teatime';
import { clearUepSettingsCache } from '../../lib/uepSettings';
import { getProgressManager } from '../../progress';
import { getReaderAuth } from '../../auth';
import { requestGuide } from '../../islands/guide/guideRequest';
import { IDENT_GUIDE_FLAG } from '../../islands/guide/identGuide';
import { shouldMountIsland } from '../../islands/islandRuntime';
import { getRegistry } from '../actionRegistry';
import { GROUPS } from '../groups';

/** `protectionActions` 的兩個 action 也掛這一組（同為 Reader 頁的行為層開關） */
const GROUP_RHYTHM = GROUPS.READER;
const GROUP_GUIDE = GROUPS.GUIDE;

const GUIDE_TARGETS = [
  'ident',
  'history',
  'concepts',
  'echoes',
  'visuals',
  'storage',
] as const;
type GuideTarget = (typeof GUIDE_TARGETS)[number];

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
      label: '立刻跳出休息提醒（照機率擲骰）',
      description:
        '走與正常判定相同的提交路徑，「知道了」的行為（重設 baseline + 開始冷卻）完全一致。變體照站台設定的機率決定，所以多半會是一般版。只在 History Reader 可用',
      available: hasRestBridge,
      execute: () => {
        if (!window.__uepRestReminderTest) {
          log('休息提醒 bridge 未掛載——請在 History Reader 頁面使用');
          return;
        }
        window.__uepRestReminderTest.trigger();
      },
    },
    /* 兩個變體各給一個入口：邀茶版預設只有一成，靠擲骰驗收要按很多次 */
    ...(
      [
        ['lazy', '一般版', '趴著的立繪，只有「知道了」一顆鈕'],
        [
          'invite',
          '邀茶版',
          '換成手上有茶的立繪與另一組文案，多一顆「前往茶會」（按下去會標記旗標並導向 /teatime）',
        ],
      ] as const
    ).map(([variant, label, description]) => ({
      group: GROUP_RHYTHM,
      id: `rhythm:trigger-rest-${variant}`,
      label: `跳出休息提醒：${label}`,
      description,
      available: hasRestBridge,
      execute: () => {
        if (!window.__uepRestReminderTest) {
          log('休息提醒 bridge 未掛載——請在 History Reader 頁面使用');
          return;
        }
        window.__uepRestReminderTest.trigger(variant);
      },
    })),
    {
      group: GROUP_RHYTHM,
      id: 'rhythm:teatime-served',
      label: '開啟茶會頁（有人版）',
      description:
        '先寫下邀請旗標再導向 /teatime，等同從休息提醒按「前往茶會」。直接打網址進去看到的是空桌子——旗標是消費即清的，重整一次就會退回空景',
      execute: () => {
        markTeatimeInvited();
        window.location.assign('/teatime');
      },
    },
    {
      group: GROUP_RHYTHM,
      id: 'rhythm:teatime-empty',
      label: '開啟茶會頁（空景）',
      description: '不帶旗標，看的是直接打網址進來的樣子',
      execute: () => {
        window.location.assign('/teatime');
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

  // ── 教學 ──

  // 2026-08-04：教學改為事件驅動（解鎖儀式收束／識別證掛上／偏好面板回顧），
  // 「已看過」紀錄與每分頁上限一併移除，所以這裡不再有對應的清除 action。
  registry.register([
    ...GUIDE_TARGETS.map((id: GuideTarget) => ({
      group: GROUP_GUIDE,
      id: `guide:play:${id}`,
      label: id === 'ident' ? '播放識別證的教學' : `播放 ${id} 島的教學`,
      description:
        id === 'ident'
          ? '與偏好面板的回顧同一條路徑。需已登入，教學會自己把證卡翻開'
          : '與偏好面板的回顧同一條路徑。島必須已解鎖且未停用',
      // 守門條件與 GuideRunner 完全一致——不合格時那邊會直接 return，
      // 按鈕按下去毫無反應。灰掉才看得出原因
      available: () =>
        id === 'ident'
          ? getReaderAuth().isLoggedIn()
          : shouldMountIsland(getProgressManager().getState(), id),
      execute: () => {
        requestGuide(id);
      },
    })),
    {
      group: GROUP_GUIDE,
      id: 'guide:reset-ident-flag',
      label: '清除識別證教學的「已看過」',
      description: `撤銷 ${IDENT_GUIDE_FLAG} 旗標。下次登入儀式後會再演一次`,
      execute: () => {
        getProgressManager().revokeFlags([IDENT_GUIDE_FLAG]);
        log('已撤銷；下次登入時會重演');
      },
    },
  ]);
}
