/**
 * Storage 解鎖儀式 — 一張孤零零的紙條（S9-B）
 *
 * 只出現在 `clearing=boxes` 頁面右側的一張灰便條。點一下抖落一次灰塵
 * （粒子噴發 + 紙色往暖黃回一格），抖滿 `DUST_STEPS` 下就解鎖便條島。
 *
 * 三個刻意的設計選擇：
 *
 * 1. **進度不落地**——離開 boxes 頁或重整就從頭來（艾斯維爾定案）。所以
 *    這裡一律用元件內 state，不碰 progressStore / pinnedStore；元件卸載
 *    即歸零，天然滿足「離開就重置」。
 * 2. **可拖曳但不記錄位置**——手感照真便條（同一組 pointer 事件、同一個
 *    `DRAG_THRESHOLD`），但落點只存在元件內部。它還不是一張真的便條，
 *    釘選對它沒有意義。
 * 3. **position: fixed + transform 位移**——boxes 頁的 `.sto-clearing-page` 是
 *    920px 置中窄欄，祖先 `.sto-content` 有 `overflow-x: hidden`，用負值 offset
 *    往右掛會被裁掉，所以定位走 fixed。
 *
 *    但拖曳**不能**改 `left/top`：`.sto-page-transition` 帶 `will-change:
 *    transform`，那會建立 containing block——裡面的 fixed 元素其實是相對
 *    那個容器定位，而 `getBoundingClientRect()` 給的是 viewport 座標，兩者
 *    對不上，一設值元素就飛出畫面（07/25 一驗：「拖曳就直接消失」）。
 *    改成累積位移灌進 CSS 變數、由 `transform: translate()` 消化，
 *    containing block 是誰都不影響。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { DRAG_THRESHOLD } from '../../islands/storage/dragToPin';

import './StorageLoneNote.css';

/** 抖幾下才乾淨（艾斯維爾定案：十下） */
const DUST_STEPS = 10;

/** 抖滿後的收束動畫時長（ms），與 CSS sto-lone-settle 對齊 */
const SETTLE_MS = 1400;

/** 每次點擊噴出的灰塵顆數 */
const DUST_PER_BURST = 10;

/** 塵封時的紙色 → 乾淨時的便條黃（與 PinnedNoteLayer 的 #fff1ba 對齊） */
const PAPER_DUSTY: [number, number, number] = [176, 174, 165];
const PAPER_CLEAN: [number, number, number] = [255, 241, 186];
const INK_DUSTY: [number, number, number] = [122, 118, 105];
const INK_CLEAN: [number, number, number] = [58, 47, 8];

function mix(
  from: [number, number, number],
  to: [number, number, number],
  t: number
): string {
  const c = from.map((v, i) => Math.round(v + (to[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

interface DustParticle {
  id: number;
  /** 噴發角度（deg）與距離（px），交給 CSS 變數 */
  angle: number;
  dist: number;
  size: number;
  duration: number;
}

interface Props {
  /** 抖乾淨、收束動畫播完後呼叫（解鎖由呼叫端執行） */
  onCleaned: () => void;
}

export default function StorageLoneNote({ onCleaned }: Props) {
  const [level, setLevel] = useState(0);
  const [particles, setParticles] = useState<DustParticle[]>([]);
  const [settling, setSettling] = useState(false);
  /** 相對初始位置的累積位移（不是絕對座標，理由見檔頭第 3 點） */
  const [offset, setOffset] = useState({ dx: 0, dy: 0 });
  const [dragging, setDragging] = useState(false);

  const particleIdRef = useRef(0);
  const settleTimerRef = useRef<number | null>(null);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    baseDx: number;
    baseDy: number;
    moved: boolean;
  } | null>(null);
  const noteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
    };
  }, []);

  /** 噴一撮灰。動畫結束後由 onAnimationEnd 自行回收。 */
  const burstDust = useCallback(() => {
    const batch: DustParticle[] = Array.from(
      { length: DUST_PER_BURST },
      () => ({
        id: particleIdRef.current++,
        angle: Math.random() * 360,
        dist: 26 + Math.random() * 46,
        size: 2 + Math.random() * 3,
        duration: 0.7 + Math.random() * 0.6,
      })
    );
    setParticles((prev) => [...prev, ...batch]);
  }, []);

  const removeParticle = useCallback((id: number) => {
    setParticles((prev) => prev.filter((p) => p.id !== id));
  }, []);

  /** 抖一下 */
  const shake = useCallback(() => {
    if (settling) return;
    burstDust();
    setLevel((prev) => {
      const next = Math.min(prev + 1, DUST_STEPS);
      if (next >= DUST_STEPS && settleTimerRef.current === null) {
        setSettling(true);
        settleTimerRef.current = window.setTimeout(() => {
          settleTimerRef.current = null;
          onCleaned();
        }, SETTLE_MS);
      }
      return next;
    });
  }, [burstDust, onCleaned, settling]);

  /* ── 拖曳（照真便條的手感，但落點不存） ── */

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (settling) return;
    dragStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseDx: offset.dx,
      baseDy: offset.dy,
      moved: false,
    };
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const st = dragStateRef.current;
    if (!st) return;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    if (!st.moved && Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;

    if (!st.moved) {
      st.moved = true;
      setDragging(true);
      // pointer capture 只在確認進入拖曳態後才抓——先抓會讓輕點也被
      // 當成拖曳手勢，click 就再也發不出來（S9-A 07/24 二次驗收的教訓）
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setOffset({ dx: st.baseDx + dx, dy: st.baseDy + dy });
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const st = dragStateRef.current;
    dragStateRef.current = null;
    if (!st) return;
    if (st.moved) {
      setDragging(false);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      return;
    }
    // 沒超過門檻 = 這是一次點擊
    shake();
  }

  const t = level / DUST_STEPS;
  const remaining = DUST_STEPS - level;

  return (
    <div
      ref={noteRef}
      className={`sto-lone-note${dragging ? ' is-dragging' : ''}${
        settling ? ' is-settling' : ''
      }`}
      style={
        {
          // 位移交給 CSS 變數，transform 在 CSS 裡組（含 settling keyframes——
          // animation 會蓋掉 inline transform，用變數才不會拖曳位置被歸零）
          '--sto-lone-dx': `${offset.dx}px`,
          '--sto-lone-dy': `${offset.dy}px`,
          // 紙色與字色隨抖落進度回暖
          '--sto-lone-paper': mix(PAPER_DUSTY, PAPER_CLEAN, t),
          '--sto-lone-ink': mix(INK_DUSTY, INK_CLEAN, t),
          '--sto-lone-dust': String(1 - t),
        } as React.CSSProperties
      }
      role="button"
      tabIndex={0}
      aria-label={
        settling
          ? '紙條已經乾淨了。'
          : `一張孤零零的紙條，積了灰。還要再拍 ${remaining} 下。`
      }
      title="一張孤零零的紙條……上面積了厚厚一層灰。"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          shake();
        }
      }}
    >
      <span className="sto-lone-note__tape" aria-hidden />
      <span className="sto-lone-note__text">一張孤零零的紙條</span>

      {/* 積在紙面上的灰，隨進度淡出 */}
      <span className="sto-lone-note__grime" aria-hidden />

      {/* 抖落的灰塵 */}
      <span className="sto-lone-note__dust" aria-hidden>
        {particles.map((p) => (
          <span
            key={p.id}
            className="sto-lone-dust-mote"
            style={
              {
                '--mote-angle': `${p.angle}deg`,
                '--mote-dist': `${p.dist}px`,
                width: p.size,
                height: p.size,
                animationDuration: `${p.duration}s`,
              } as React.CSSProperties
            }
            onAnimationEnd={() => removeParticle(p.id)}
          />
        ))}
      </span>
    </div>
  );
}
