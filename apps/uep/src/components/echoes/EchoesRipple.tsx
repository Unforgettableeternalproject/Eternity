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
export default function EchoesRipple({ isPlaying = false, color }: Props) {
  const [orbs, setOrbs] = useState<Orb[]>([]);
  const idRef = useRef(0);
  const orbsRef = useRef<Orb[]>([]);
  const activeRef = useRef(true);
  const tidRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 用 ref 追蹤 isPlaying，讓 spawn 閉包能讀到最新值
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // 同步 ref 讓 spawn 能讀到最新狀態
  useEffect(() => {
    orbsRef.current = orbs;
  }, [orbs]);

  const removeOrb = useCallback((id: number) => {
    setOrbs((prev) => prev.filter((o) => o.id !== id));
  }, []);

  // spawn 與 schedule 提取為 ref callback，讓外部 effect 也能呼叫
  const spawnRef = useRef<() => void>();
  const scheduleRef = useRef<() => void>();

  spawnRef.current = () => {
    if (!activeRef.current) return;
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
    return () => {
      activeRef.current = false;
      if (tidRef.current) clearTimeout(tidRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
            const angle = (360 / o.particles) * i + ((o.id * 17 + i * 53) % 30);
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
  );
}
