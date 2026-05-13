import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './VisualsPhantom.css';

// ──────────────────────────────────────────────────────────────
// 型別
// ──────────────────────────────────────────────────────────────
export type PhantomVariant =
  | 'landing'
  | 'profiles'
  | 'illustrations'
  | 'sketchs'
  | 'pixel';

interface Props {
  variant?: PhantomVariant;
}

// ──────────────────────────────────────────────────────────────
// 確定性偽隨機 — 相同 variant 永遠產生相同框架佈局
// ──────────────────────────────────────────────────────────────
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ──────────────────────────────────────────────────────────────
// 框架設定（各 variant）
// ──────────────────────────────────────────────────────────────
interface Cfg {
  n: number; // 框架數量
  w: [number, number]; // 寬度範圍 (px)
  ar: [number, number]; // 高寬比範圍 (h/w)
  dur: [number, number]; // 動畫週期範圍 (s)
  rot: number; // 最大旋轉角度 (deg)
  blob: boolean; // 是否顯示框內色塊暗示
  snap: boolean; // 位置是否對齊網格（pixel 用）
}

const CFG: Record<PhantomVariant, Cfg> = {
  // 十字路口：混合框架比例
  landing: {
    n: 14,
    w: [50, 130],
    ar: [0.7, 1.4],
    dur: [7, 13],
    rot: 0,
    blob: true,
    snap: false,
  },
  // 陳列走廊：直立肖像比例
  profiles: {
    n: 16,
    w: [40, 90],
    ar: [1.2, 1.8],
    dur: [8, 15],
    rot: 0,
    blob: true,
    snap: false,
  },
  // 鑲框室：橫幅畫作比例
  illustrations: {
    n: 12,
    w: [70, 150],
    ar: [0.5, 0.8],
    dur: [8, 14],
    rot: 0,
    blob: true,
    snap: false,
  },
  // 抽象萃取間：小框、有旋轉
  sketchs: {
    n: 18,
    w: [30, 75],
    ar: [0.8, 1.3],
    dur: [5, 11],
    rot: 12,
    blob: false,
    snap: false,
  },
  // 基底實驗室：方形框、網格對齊
  pixel: {
    n: 12,
    w: [32, 68],
    ar: [0.92, 1.08],
    dur: [6, 12],
    rot: 0,
    blob: false,
    snap: true,
  },
};

// ──────────────────────────────────────────────────────────────
// 射線系統
// ──────────────────────────────────────────────────────────────
interface RayStreak {
  id: number;
  angle: number; // 移動方向 (deg)
  x: string; // 起始 left (CSS 值)
  y: string; // 起始 top (CSS 值)
  dur: number; // 穿越時間 (s)
  delay: number; // 群組內延遲 (s)
  len: number; // 光痕長度 (px)
  hue: number; // 色相偏移 (deg)
  bright: number; // 明度倍率
}

/** 八個方向 (deg) */
const DIRS = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * 根據方向與邊緣位置百分比，計算射線的起始座標
 * pos: 0-100，代表沿起始邊的百分比位置
 */
function getEdgePos(dir: number, pos: number): { x: string; y: string } {
  const p = Math.max(5, Math.min(95, pos));
  switch (dir) {
    case 0: // → 從左邊進
      return { x: '-160px', y: `${p}vh` };
    case 45: // ↘ 從左上角區域進
      return { x: `${p * 0.45}vw`, y: '-160px' };
    case 90: // ↓ 從上方進
      return { x: `${p}vw`, y: '-160px' };
    case 135: // ↙ 從右上角區域進
      return { x: `${50 + p * 0.5}vw`, y: '-160px' };
    case 180: // ← 從右邊進
      return { x: 'calc(100vw + 160px)', y: `${p}vh` };
    case 225: // ↖ 從右下角區域進
      return { x: `${50 + p * 0.5}vw`, y: 'calc(100vh + 160px)' };
    case 270: // ↑ 從下方進
      return { x: `${p}vw`, y: 'calc(100vh + 160px)' };
    case 315: // ↗ 從左下角區域進
      return { x: `${p * 0.45}vw`, y: 'calc(100vh + 160px)' };
    default:
      return { x: '-160px', y: '50vh' };
  }
}

// ──────────────────────────────────────────────────────────────
// 元件
// ──────────────────────────────────────────────────────────────
export default function VisualsPhantom({ variant = 'landing' }: Props) {
  const c = CFG[variant];

  /* ── 確定性框架 ── */
  const frames = useMemo(() => {
    const r = seeded(variant.charCodeAt(0) * 137 + 42);
    return Array.from({ length: c.n }, (_, i) => {
      const w = c.w[0] + r() * (c.w[1] - c.w[0]);
      const ar = c.ar[0] + r() * (c.ar[1] - c.ar[0]);
      const h = w * ar;
      const dur = c.dur[0] + r() * (c.dur[1] - c.dur[0]);
      const delay = r() * dur;
      let top = 5 + r() * 85;
      let left = 5 + r() * 85;
      if (c.snap) {
        top = Math.round(top / 10) * 10;
        left = Math.round(left / 10) * 10;
      }
      const rot = c.rot > 0 ? (r() - 0.5) * 2 * c.rot : 0;
      return { w, h, top, left, dur, delay, rot, i };
    });
  }, [variant, c]);

  /* ── 動態射線生成器 ── */
  const [rays, setRays] = useState<RayStreak[]>([]);
  const idRef = useRef(0);

  const removeRay = useCallback((id: number) => {
    setRays((prev) => prev.filter((r) => r.id !== id));
  }, []);

  useEffect(() => {
    setRays([]);
    idRef.current = 0;
    let active = true;
    let tid: ReturnType<typeof setTimeout>;

    function spawn() {
      if (!active) return;

      // 隨機選一個方向
      const dir = DIRS[Math.floor(Math.random() * DIRS.length)];
      // 伴隨射線數量 1-3
      const count = 1 + Math.floor(Math.random() * 3);
      // 群組在邊緣的基準位置
      const basePos = 15 + Math.random() * 70;

      const group: RayStreak[] = [];
      for (let i = 0; i < count; i++) {
        // 伴隨射線的角度偏移（±5°）
        const angleOff = (Math.random() - 0.5) * 10;
        // 伴隨射線的位置偏移（±10%）
        const posOff = (Math.random() - 0.5) * 20;
        const pos = getEdgePos(dir, basePos + posOff);

        group.push({
          id: idRef.current++,
          angle: dir + angleOff,
          x: pos.x,
          y: pos.y,
          dur: 4 + Math.random() * 4, // 4-8s 穿越（更慢）
          delay: i * (0.2 + Math.random() * 0.6), // 群組內錯開
          len: 140 + Math.random() * 100, // 140-240px 長
          hue: (Math.random() - 0.5) * 30, // ±15° 色相偏移
          bright: 0.85 + Math.random() * 0.3, // 0.85-1.15 明度偏移
        });
      }

      setRays((prev) => [...prev, ...group]);
      schedule();
    }

    function schedule() {
      if (!active) return;
      // 5-10 秒後產生下一組
      tid = setTimeout(spawn, 5000 + Math.random() * 5000);
    }

    // 首次稍後生成
    tid = setTimeout(spawn, 1200);

    return () => {
      active = false;
      clearTimeout(tid);
    };
  }, [variant]);

  return (
    <div
      className={`visuals-phantom visuals-phantom--${variant}`}
      aria-hidden="true"
    >
      {/* ── 射線群 ── */}
      {rays.map((r) => (
        <div
          key={r.id}
          className="vp-ray-anchor"
          style={{
            left: r.x,
            top: r.y,
            rotate: `${r.angle}deg`,
          }}
        >
          <div
            className="vp-ray-streak"
            style={{
              width: r.len,
              animationDuration: `${r.dur}s`,
              animationDelay: `${r.delay}s`,
              '--ray-hue': `${r.hue}deg`,
              '--ray-bright': r.bright,
            } as React.CSSProperties}
            onAnimationEnd={() => removeRay(r.id)}
          />
        </div>
      ))}

      {/* ── 幻影框架 ── */}
      {frames.map((f) => (
        <div
          key={`f${f.i}`}
          className="vp-frame"
          style={{
            width: f.w,
            height: f.h,
            top: `${f.top}%`,
            left: `${f.left}%`,
            transform: f.rot ? `rotate(${f.rot}deg)` : undefined,
            animationDuration: `${f.dur}s`,
            animationDelay: `${f.delay}s`,
          }}
        >
          {c.blob && <div className="vp-blob" />}
        </div>
      ))}
    </div>
  );
}
