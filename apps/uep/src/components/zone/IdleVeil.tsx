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
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  getDispelPointer,
  getDispelTrail,
  getLiveDispel,
  getVeilServerState,
  getVeilState,
  subscribeVeil,
  TRAIL_MAX,
} from '../../lib/idleVeil';
import { markUepAfk } from '../../progress/uepFlags';

import './IdleVeil.css';

/** 散去動畫的長度，與 CSS 的 `.ivl--leaving` 對齊 */
const LEAVE_MS = 620;

export default function IdleVeil() {
  const veil = useSyncExternalStore(
    subscribeVeil,
    getVeilState,
    getVeilServerState
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);

  /* `uep:afk`（見過閒置帷幕全遮）——授予點放在渲染端而不是 idleVeil 內部：
     「見過」的定義是畫面真的被「空曠~」佔滿過，而 lib 層算出 stage 3 與
     使用者實際看到之間還隔著這個元件有沒有掛載。順帶也避免純狀態模組
     反過來依賴 progressStore。 */
  useEffect(() => {
    if (veil.stage === 3) markUepAfk();
  }, [veil.stage]);

  const active = veil.stage > 0;
  /**
   * 散去期間狀態已經歸零（stage 0、coverage 0），但畫面上還要有東西可以淡。
   * 留住最後一次可見的樣子，淡出時照著它渲染。
   */
  const lastVisible = useRef(veil);
  if (active) lastVisible.current = veil;

  /*
   * 撥開的那一刻不要直接卸載——整層淡出之後才收。
   *
   * 這裡刻意只看 `active` 的變化：帷幕收掉的路徑不只一條（撥散、換頁前的
   * stop、DevTools 重置），全部都會落到 stage 0，在這裡統一處理比在每個
   * 出口各補一次淡出可靠。
   */
  useEffect(() => {
    if (active) {
      setLeaving(false);
      return undefined;
    }
    // 從來沒顯示過就不必演散去（初次掛載時 stage 本來就是 0）
    if (lastVisible.current.stage === 0) return undefined;
    setLeaving(true);
    const timer = window.setTimeout(() => {
      setLeaving(false);
      lastVisible.current = getVeilState();
    }, LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [active]);

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

  const shown = active ? veil : lastVisible.current;
  if ((!active && !leaving) || shown.coverage <= 0) return null;

  return (
    <div
      ref={rootRef}
      className={`ivl ivl--s${shown.stage}${leaving ? ' ivl--leaving' : ''}`}
      // --ivl-c 註冊成 <number>（見 CSS 的 @property），所以這個值的變化
      // 會被 transition 插值——不然 gradient 是逐格硬跳的
      style={{ '--ivl-c': shown.coverage } as React.CSSProperties}
      aria-hidden="true"
    >
      {/* 會被擦開的東西全放這一層裡：洞掛在它身上，而它與 viewport 對齊
          且不動。放到外面或各層自己扣，洞就會跟著那層的 inset 與 drift 跑掉
          （見 IdleVeil.css 的 .ivl-wipe） */}
      <div className="ivl-wipe">
        <div className="ivl-fog ivl-fog--a" />
        <div className="ivl-fog ivl-fog--b" />
        <div className="ivl-static" />
        {shown.stage === 3 && <div className="ivl-face" />}
      </div>
      {/* key 換掉 → React 重新掛載 → 湧入動畫重播。用 class 切換的話
          同一個元素不會重新觸發 animation */}
      <div className="ivl-surge" key={shown.stage} />
      {shown.stage === 3 && <div className="ivl-word">空曠~</div>}
    </div>
  );
}
