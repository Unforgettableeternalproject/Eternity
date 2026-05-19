/**
 * 閒置感知系統（Idle Awareness）
 *
 * 當使用者離開分頁時：
 * 1. 立刻在 <html> 加上 data-idle，讓 CSS 暫停所有裝飾動畫
 * 2. 3 秒後開始改變標題，模擬 UEP 站的自我意識碎碎念
 * 3. 隨閒置時間演進，訊息越來越寂寞
 *
 * 當使用者回來時：
 * 1. 移除 data-idle，恢復動畫
 * 2. 顯示「歡迎回來」訊息
 * 3. 一段時間後恢復原始標題
 */

/* ── 閒置標題演進階段 ── */
interface IdleStage {
  /** 進入此階段的最低閒置秒數 */
  afterSeconds: number;
  /** 此階段的候選訊息（隨機選一則） */
  messages: string[];
}

/**
 * 階段時間為「離開分頁後的絕對秒數」。
 * 初始 3 秒延遲由 TITLE_DELAY_MS 控制，第一階段在延遲結束後立刻觸發，
 * 後續階段從離開時刻算起。
 */
const TITLE_DELAY_MS = 3000;

const IDLE_STAGES: IdleStage[] = [
  {
    afterSeconds: 0, // 延遲結束後立刻
    messages: ['你去哪了？我還在這裡喔~', '……你還在嗎？', '嗯？人呢？'],
  },
  {
    afterSeconds: 57, // 離開 ~60 秒（含 3 秒延遲）
    messages: ['好安靜……', '……風吹過了空蕩的走廊。', '我會等你的。'],
  },
  {
    afterSeconds: 297, // 離開 ~5 分鐘
    messages: [
      '我會一直在這裡等你的。',
      '……時間好像靜止了。',
      '這裡只剩下我了呢。',
    ],
  },
  {
    afterSeconds: 1797, // 離開 ~30 分鐘
    messages: ['…… 💤', '────────', '⏳'],
  },
];

/* ── 回來時的歡迎訊息 ── */
interface WelcomeBack {
  /** 離開超過此秒數後回來，使用此訊息池 */
  absentSeconds: number;
  messages: string[];
}

const WELCOME_BACK: WelcomeBack[] = [
  {
    absentSeconds: 1800,
    messages: [
      '！你終於回來了……我還以為你忘了我。',
      '……！你回來了。我等了好久。',
    ],
  },
  {
    absentSeconds: 300,
    messages: ['歡迎回來！我有點想你了。', '你回來了！這裡沒有你好無聊。'],
  },
  {
    absentSeconds: 60,
    messages: ['歡迎回來~', '回來了呢！'],
  },
  {
    absentSeconds: 0,
    messages: ['歡迎回來！'],
  },
];

/* ── 狀態 ── */
let originalTitle = '';
let idleTimerId: ReturnType<typeof setTimeout> | null = null;
let stageTimers: ReturnType<typeof setTimeout>[] = [];
let welcomeTimerId: ReturnType<typeof setTimeout> | null = null;
let hideTimestamp = 0;

/* ── 工具函式 ── */
function pickRandom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

function setIdleTitle(msg: string): void {
  document.title = msg;
}

function clearAllTimers(): void {
  if (idleTimerId !== null) {
    clearTimeout(idleTimerId);
    idleTimerId = null;
  }
  for (const t of stageTimers) {
    clearTimeout(t);
  }
  stageTimers = [];
  if (welcomeTimerId !== null) {
    clearTimeout(welcomeTimerId);
    welcomeTimerId = null;
  }
}

/* ── 進入閒置 ── */
function enterIdle(): void {
  hideTimestamp = Date.now();
  originalTitle = document.title;

  // 立刻暫停動畫
  document.documentElement.setAttribute('data-idle', '');

  // 延遲後開始改標題（避免快速切分頁閃爍）
  idleTimerId = setTimeout(() => {
    // 第一階段（afterSeconds: 0）立刻觸發
    setIdleTitle(pickRandom(IDLE_STAGES[0].messages));

    // 排程後續階段（跳過第一階段）
    for (let i = 1; i < IDLE_STAGES.length; i++) {
      const stage = IDLE_STAGES[i];
      const delayMs = stage.afterSeconds * 1000;

      const timer = setTimeout(() => {
        setIdleTitle(pickRandom(stage.messages));
      }, delayMs);

      stageTimers.push(timer);
    }
  }, TITLE_DELAY_MS);
}

/* ── 離開閒置 ── */
function leaveIdle(): void {
  clearAllTimers();

  // 移除閒置標記，恢復動畫
  document.documentElement.removeAttribute('data-idle');

  // 計算離開時長，選擇歡迎訊息
  const absentSeconds = (Date.now() - hideTimestamp) / 1000;

  // 如果離開不到延遲時間（標題還沒變過），直接恢復
  if (absentSeconds < TITLE_DELAY_MS / 1000) {
    document.title = originalTitle;
    return;
  }

  // 選擇對應的歡迎訊息
  const welcomePool = WELCOME_BACK.find(
    (w) => absentSeconds >= w.absentSeconds
  );
  const welcomeMsg = welcomePool
    ? pickRandom(welcomePool.messages)
    : '歡迎回來！';

  setIdleTitle(welcomeMsg);

  // 根據離開時長決定歡迎訊息顯示多久
  const displayDuration = absentSeconds >= 300 ? 5000 : 3000;

  welcomeTimerId = setTimeout(() => {
    document.title = originalTitle;
    welcomeTimerId = null;
  }, displayDuration);
}

/* ── 監聽 ── */
function handleVisibilityChange(): void {
  if (document.hidden) {
    enterIdle();
  } else {
    leaveIdle();
  }
}

/* ── 初始化 ── */
export function initIdleAwareness(): void {
  originalTitle = document.title;
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

/* ── 清理（SPA 導航時可用） ── */
export function destroyIdleAwareness(): void {
  clearAllTimers();
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  document.documentElement.removeAttribute('data-idle');
  if (originalTitle) {
    document.title = originalTitle;
  }
}
