import React, { useCallback, useEffect, useRef, useState } from 'react';
import './EchoesRipple.css';

// ──────────────────────────────────────────────────────────────
// 型別
// ──────────────────────────────────────────────────────────────
interface Props {
  /** 是否正在播放音樂 — 播放時脈衝更快更亮 */
  isPlaying?: boolean;
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
  minDist: number,
): boolean {
  for (const o of existing) {
    const dx = x - o.x;
    const dy = y - o.y;
    if (Math.sqrt(dx * dx + dy * dy) < minDist) return false;
  }
  return true;
}

// ──────────────────────────────────────────────────────────────
// 元件
// ──────────────────────────────────────────────────────────────
export default function EchoesRipple({ isPlaying = false }: Props) {
  const [orbs, setOrbs] = useState<Orb[]>([]);
  const idRef = useRef(0);
  const orbsRef = useRef<Orb[]>([]);

  // 同步 ref 讓 spawn 能讀到最新狀態
  useEffect(() => {
    orbsRef.current = orbs;
  }, [orbs]);

  const removeOrb = useCallback((id: number) => {
    setOrbs((prev) => prev.filter((o) => o.id !== id));
  }, []);

  useEffect(() => {
    setOrbs([]);
    orbsRef.current = [];
    idRef.current = 0;
    let active = true;
    let tid: ReturnType<typeof setTimeout>;

    function spawn() {
      if (!active) return;

      // 嘗試找一個夠遠的位置（最多 10 次）
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
        size: isPlaying ? 20 + Math.random() * 16 : 16 + Math.random() * 12,
        dur: isPlaying ? 3 + Math.random() * 2 : 6 + Math.random() * 4,
        delay: Math.random() * 0.5,
        particles: isPlaying ? 4 + Math.floor(Math.random() * 3) : 3,
        rings: isPlaying ? 2 + Math.floor(Math.random() * 2) : 1,
      };

      setOrbs((prev) => [...prev, orb]);
      schedule();
    }

    function schedule() {
      if (!active) return;
      const interval = isPlaying
        ? 2000 + Math.random() * 2500
        : 5000 + Math.random() * 5000;
      tid = setTimeout(spawn, interval);
    }

    tid = setTimeout(spawn, 800);

    return () => {
      active = false;
      clearTimeout(tid);
    };
  }, [isPlaying]);

  return (
    <div
      className={`echoes-ripple ${isPlaying ? 'is-playing' : ''}`}
      aria-hidden="true"
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
            const dist = o.size * 1.2 + ((o.id * 31 + i * 71) % 100) / 100 * o.size * 0.8;
            return (
              <div
                key={`p${i}`}
                className="er-orb-dot"
                style={{
                  '--er-dot-angle': `${angle}deg`,
                  '--er-dot-dist': `${dist}px`,
                  animationDelay: `${o.delay + i * 0.15}s`,
                  animationDuration: `${o.dur * 0.8}s`,
                } as React.CSSProperties}
              />
            );
          })}

          {/* 漣漪擴散環 */}
          {Array.from({ length: o.rings }, (_, i) => (
            <div
              key={`r${i}`}
              className="er-orb-ring"
              style={{
                animationDuration: `${o.dur * (0.7 + i * 0.3)}s`,
                animationDelay: `${o.delay + i * 0.4}s`,
                '--er-ring-size': `${o.size * 6 + i * o.size * 3}px`,
              } as React.CSSProperties}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
