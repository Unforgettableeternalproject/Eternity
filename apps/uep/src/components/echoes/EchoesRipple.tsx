import React, { useCallback, useEffect, useRef, useState } from 'react';
import './EchoesRipple.css';

// ──────────────────────────────────────────────────────────────
// 型別
// ──────────────────────────────────────────────────────────────
interface Props {
  /** 是否正在播放音樂 — 播放時脈衝更快更亮 */
  isPlaying?: boolean;
  /** 主色調（hex），根據 cluster 變化 */
  color?: string;
  /**
   * 是否有資格觸發「迷失的回聲」解鎖儀式（S9-B）。
   * 為 true 時，播放中每次生成球體都會擲骰，中了就浮現一顆灰球。
   */
  unlockEligible?: boolean;
  /** 灰球被點擊、收束動畫播完後呼叫（解鎖由呼叫端執行） */
  onLostOrbCatch?: () => void;
}

interface Orb {
  id: number;
  x: number; // % from left
  y: number; // % from top
  size: number; // 中心球直徑 (px)
  dur: number; // 脈衝週期 (s)
  delay: number; // 出場延遲 (s)
  /** 環繞小粒子數量 */
  particles: number;
  /** 漣漪圈數量 */
  rings: number;
}

/** 最小生成距離（百分比單位） */
const MIN_DIST = 25;
/** 同時存在的 orb 上限：避免低階裝置同時跑太多 CSS 動畫 */
const MAX_ORBS = 4;

/**
 * 「迷失的回聲」出現機率（S9-B 解鎖儀式）。
 *
 * 每次生成球體時擲一次骰，播放中約 2~4.5 秒一次機會 → 期望播放約 50 秒
 * 浮現一顆。刻意用 flat 機率、不做 history 書籤那種累加保底：播放中球本來
 * 就多，而且灰球一旦出現就常駐到暫停為止，靠「不會錯過」補償「不保底」。
 */
const LOST_ORB_CHANCE = 0.06;

/** 灰球被點擊後的收束動畫時長（ms），與 CSS er-lost-catch 對齊 */
const LOST_ORB_CATCH_MS = 1400;

interface LostOrb {
  id: number;
  x: number;
  y: number;
  size: number;
}

function isFarEnough(
  x: number,
  y: number,
  existing: Orb[],
  minDist: number
): boolean {
  for (const o of existing) {
    const dx = x - o.x;
    const dy = y - o.y;
    if (Math.sqrt(dx * dx + dy * dy) < minDist) return false;
  }
  return true;
}

/** 將 hex 色碼轉為 [r, g, b] */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

// ──────────────────────────────────────────────────────────────
// 元件
// ──────────────────────────────────────────────────────────────
export default function EchoesRipple({
  isPlaying = false,
  color,
  unlockEligible = false,
  onLostOrbCatch,
}: Props) {
  const [orbs, setOrbs] = useState<Orb[]>([]);
  const [lostOrb, setLostOrb] = useState<LostOrb | null>(null);
  const [catching, setCatching] = useState(false);
  const idRef = useRef(0);
  const orbsRef = useRef<Orb[]>([]);
  const activeRef = useRef(true);
  const tidRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const catchTidRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 用 ref 追蹤 isPlaying，讓 spawn 閉包能讀到最新值
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // 同上：spawn 閉包只建立一次，資格與現況都要靠 ref 取最新值
  const eligibleRef = useRef(unlockEligible);
  useEffect(() => {
    eligibleRef.current = unlockEligible;
  }, [unlockEligible]);
  const lostOrbRef = useRef<LostOrb | null>(null);
  useEffect(() => {
    lostOrbRef.current = lostOrb;
  }, [lostOrb]);

  // 同步 ref 讓 spawn 能讀到最新狀態
  useEffect(() => {
    orbsRef.current = orbs;
  }, [orbs]);

  const removeOrb = useCallback((id: number) => {
    setOrbs((prev) => prev.filter((o) => o.id !== id));
  }, []);

  /** 浮現一顆「迷失的回聲」。位置沿用一般球的散開規則，避免疊在一起。 */
  const spawnLostOrb = useCallback(() => {
    let x = 15 + Math.random() * 70;
    let y = 15 + Math.random() * 70;
    for (let attempt = 0; attempt < 10; attempt++) {
      if (isFarEnough(x, y, orbsRef.current, MIN_DIST)) break;
      x = 15 + Math.random() * 70;
      y = 15 + Math.random() * 70;
    }
    setLostOrb({
      id: idRef.current++,
      x,
      y,
      size: 30 + Math.random() * 10,
    });
  }, []);

  /** 捕捉：播完收束動畫才把解鎖交給呼叫端 */
  const handleCatchLostOrb = useCallback(() => {
    if (catchTidRef.current !== null) return;
    setCatching(true);
    catchTidRef.current = setTimeout(() => {
      catchTidRef.current = null;
      setCatching(false);
      setLostOrb(null);
      onLostOrbCatch?.();
    }, LOST_ORB_CATCH_MS);
  }, [onLostOrbCatch]);

  // spawn 與 schedule 提取為 ref callback，讓外部 effect 也能呼叫
  const spawnRef = useRef<() => void>();
  const scheduleRef = useRef<() => void>();

  spawnRef.current = () => {
    if (!activeRef.current) return;

    // 「迷失的回聲」擲骰——在 MAX_ORBS 檢查之前，且灰球不佔名額：它一旦
    // 浮現就常駐到暫停為止，若計入上限會長期把一般球擠稀。
    if (
      isPlayingRef.current &&
      eligibleRef.current &&
      !lostOrbRef.current &&
      Math.random() < LOST_ORB_CHANCE
    ) {
      spawnLostOrb();
    }

    // 達到上限時跳過，等舊 orb 自然消亡後再生成
    if (orbsRef.current.length >= MAX_ORBS) {
      scheduleRef.current?.();
      return;
    }
    const playing = isPlayingRef.current;

    let x = 10 + Math.random() * 80;
    let y = 10 + Math.random() * 80;
    for (let attempt = 0; attempt < 10; attempt++) {
      if (isFarEnough(x, y, orbsRef.current, MIN_DIST)) break;
      x = 10 + Math.random() * 80;
      y = 10 + Math.random() * 80;
    }

    const orb: Orb = {
      id: idRef.current++,
      x,
      y,
      size: playing ? 20 + Math.random() * 16 : 16 + Math.random() * 12,
      dur: playing ? 3 + Math.random() * 2 : 6 + Math.random() * 4,
      delay: Math.random() * 0.5,
      particles: playing ? 4 + Math.floor(Math.random() * 3) : 3,
      rings: playing ? 2 + Math.floor(Math.random() * 2) : 1,
    };

    setOrbs((prev) => [...prev, orb]);
    scheduleRef.current?.();
  };

  scheduleRef.current = () => {
    if (!activeRef.current) return;
    const playing = isPlayingRef.current;
    const interval = playing
      ? 2000 + Math.random() * 2500
      : 5000 + Math.random() * 5000;
    if (tidRef.current) clearTimeout(tidRef.current);
    tidRef.current = setTimeout(() => spawnRef.current?.(), interval);
  };

  // 啟動 spawn 迴圈（僅 mount 一次）
  useEffect(() => {
    activeRef.current = true;
    tidRef.current = setTimeout(() => spawnRef.current?.(), 800);

    // 頁面隱藏時清除 timeout，避免背景分頁持續生成新 orb
    function handleVisibility() {
      if (document.hidden) {
        if (tidRef.current) {
          clearTimeout(tidRef.current);
          tidRef.current = null;
        }
      } else {
        // 頁面重新顯示時，若沒有排程中的 timeout 就重新啟動
        if (!tidRef.current && activeRef.current) {
          scheduleRef.current?.();
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      activeRef.current = false;
      if (tidRef.current) clearTimeout(tidRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // 收束計時器的卸載清理（離開頁面時捕捉中斷，不該回頭呼叫 onLostOrbCatch）
  useEffect(() => {
    return () => {
      if (catchTidRef.current !== null) clearTimeout(catchTidRef.current);
    };
  }, []);

  // 暫停即散去：灰球只在音樂還在響的時候留著（艾斯維爾定案）。
  // 捕捉動畫進行中不打斷——那 1.4 秒已經是「抓住了」，暫停不該把它奪走。
  useEffect(() => {
    if (!isPlaying && !catching) setLostOrb(null);
  }, [isPlaying, catching]);

  // 失去資格（例如登出、切觀測者、島已由別處解鎖）時一併散去
  useEffect(() => {
    if (!unlockEligible && !catching) setLostOrb(null);
  }, [unlockEligible, catching]);

  // isPlaying 改變時：取消當前排程，用新的間隔立刻重新排程（不清空現有 orbs）
  useEffect(() => {
    if (tidRef.current) clearTimeout(tidRef.current);
    // 用較短的延遲產生下一顆，讓切換後的節奏感快速反映
    const delay = isPlaying
      ? 500 + Math.random() * 1000
      : 2000 + Math.random() * 2000;
    tidRef.current = setTimeout(() => spawnRef.current?.(), delay);
  }, [isPlaying]);

  // 計算 CSS custom properties
  const [r, g, b] = color ? hexToRgb(color) : [53, 92, 125];

  return (
    <>
      {/* 「迷失的回聲」刻意渲染在特效層之外的獨立層：特效層整層掛
          aria-hidden="true"（純裝飾），而灰球是真正的互動元素，藏在
          aria-hidden 底下會讓輔助技術使用者完全拿不到解鎖途徑。 */}
      {lostOrb && (
        <div className="echoes-lost-layer">
          <button
            type="button"
            className={`er-lost-orb${catching ? ' is-catching' : ''}`}
            style={{
              left: `${lostOrb.x}%`,
              top: `${lostOrb.y}%`,
              width: lostOrb.size,
              height: lostOrb.size,
            }}
            onClick={handleCatchLostOrb}
            disabled={catching}
            aria-label="一枚不合群的回聲。點擊以捕捉。"
            title="一枚不合群的回聲……它沒有跟著散去。"
          >
            <span className="er-lost-orb__core" aria-hidden />
            <span className="er-lost-orb__halo" aria-hidden />
          </button>
        </div>
      )}

      <div
        className={`echoes-ripple ${isPlaying ? 'is-playing' : ''}`}
        aria-hidden="true"
        style={
          {
            '--er-r': r,
            '--er-g': g,
            '--er-b': b,
          } as React.CSSProperties
        }
      >
        {orbs.map((o) => (
          <div
            key={o.id}
            className="er-orb"
            style={{
              left: `${o.x}%`,
              top: `${o.y}%`,
              animationDuration: `${o.dur}s`,
              animationDelay: `${o.delay}s`,
            }}
            onAnimationEnd={(e) => {
              // 只在 er-orb-life 動畫結束時移除，忽略子元素冒泡的事件
              if (e.animationName === 'er-orb-life') removeOrb(o.id);
            }}
          >
            {/* 中心發光球 */}
            <div
              className="er-orb-core"
              style={{ width: o.size, height: o.size }}
            />

            {/* 環繞小粒子 */}
            {Array.from({ length: o.particles }, (_, i) => {
              const angle =
                (360 / o.particles) * i + ((o.id * 17 + i * 53) % 30);
              const dist =
                o.size * 1.2 +
                (((o.id * 31 + i * 71) % 100) / 100) * o.size * 0.8;
              return (
                <div
                  key={`p${i}`}
                  className="er-orb-dot"
                  style={
                    {
                      '--er-dot-angle': `${angle}deg`,
                      '--er-dot-dist': `${dist}px`,
                      animationDelay: `${o.delay + i * 0.15}s`,
                      animationDuration: `${o.dur * 0.8}s`,
                    } as React.CSSProperties
                  }
                />
              );
            })}

            {/* 漣漪擴散環 */}
            {Array.from({ length: o.rings }, (_, i) => (
              <div
                key={`r${i}`}
                className="er-orb-ring"
                style={
                  {
                    animationDuration: `${o.dur * (0.7 + i * 0.3)}s`,
                    animationDelay: `${o.delay + i * 0.4}s`,
                    '--er-ring-size': `${o.size * 6 + i * o.size * 3}px`,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
