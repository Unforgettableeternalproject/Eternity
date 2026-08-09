/**
 * 閒置帷幕的渲染層（S10-4 A 段，2026-08-04）
 *
 * 狀態全在 `lib/idleVeil.ts`，這裡只負責把它換成畫面。
 *
 * **完全不吃互動**（`pointer-events: none`）：帷幕不是攔阻，撥開它的方式就是
 * 動——而動作本來就被 idleVeil 聽著。加任何按鈕都會把「動一下就散」變成
 * 「找到那顆鈕再按」。
 *
 * ## 為什麼要一個 rAF loop
 *
 * 訂閱者拿到的狀態是 250ms 更新一次的，那個頻率對兩件事不夠：
 *
 * 1. **擦拭洞要貼著指標**——慢 250ms 會像洞在追滑鼠
 * 2. **驅散進度要即時反映**——使用者撥開的手感全在這裡
 *
 * 但這兩件事都不需要 React 知道：rAF 內直接寫 CSS 變數，React 只在
 * `stage` 變化（一分鐘幾次）時重渲染。高頻更新走 DOM，不走 state——
 * 與 `activityWatch`／`idleVeil` 同一個原則。
 *
 * loop 只在帷幕升起時跑，收掉就停。
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';

import {
  getDispelPointer,
  getDispelTrail,
  getLiveDispel,
  getVeilServerState,
  getVeilState,
  subscribeVeil,
  TRAIL_MAX,
} from '../../lib/idleVeil';

import './IdleVeil.css';

export default function IdleVeil() {
  const veil = useSyncExternalStore(
    subscribeVeil,
    getVeilState,
    getVeilServerState
  );
  const rootRef = useRef<HTMLDivElement>(null);

  const active = veil.stage > 0;

  useEffect(() => {
    if (!active) return undefined;
    let raf = 0;
    const paint = () => {
      const root = rootRef.current;
      if (root) {
        const dispel = getLiveDispel();
        const pointer = getDispelPointer();
        root.style.setProperty('--ivl-d', String(dispel));
        if (pointer) {
          root.style.setProperty('--ivl-px', `${pointer.x}px`);
          root.style.setProperty('--ivl-py', `${pointer.y}px`);
        }
        /*
         * 走過的路也要留著。CSS 那邊寫死了 TRAIL_MAX 組座標變數，這裡
         * 逐一填——沒填到的維持在畫面外（CSS 的預設值），那幾層 gradient
         * 就等於不存在。
         *
         * 用固定變數而不是每幀組一長串 gradient 字串：字串每幀都要重新
         * 解析整份 mask，變數只是改幾個數字。
         */
        const trail = getDispelTrail();
        for (let i = 0; i < TRAIL_MAX; i += 1) {
          const point = trail[i];
          if (!point) break;
          root.style.setProperty(`--ivl-tx${i}`, `${point.x}px`);
          root.style.setProperty(`--ivl-ty${i}`, `${point.y}px`);
        }
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  if (!active || veil.coverage <= 0) return null;

  return (
    <div
      ref={rootRef}
      className={`ivl ivl--s${veil.stage}`}
      // --ivl-c 註冊成 <number>（見 CSS 的 @property），所以這個值的變化
      // 會被 transition 插值——不然 gradient 是逐格硬跳的
      style={{ '--ivl-c': veil.coverage } as React.CSSProperties}
      aria-hidden="true"
    >
      <div className="ivl-fog ivl-fog--a" />
      <div className="ivl-fog ivl-fog--b" />
      <div className="ivl-static" />
      {/* key 換掉 → React 重新掛載 → 湧入動畫重播。用 class 切換的話
          同一個元素不會重新觸發 animation */}
      <div className="ivl-surge" key={veil.stage} />
      {veil.stage === 3 && (
        <>
          {/* 霧最濃的時候她的臉浮出來。跟每一層霧套同一個擦拭洞，
              所以指標撥過去時臉也會跟著被擦開 */}
          <div className="ivl-face" />
          <div className="ivl-word">空曠~</div>
        </>
      )}
    </div>
  );
}
