/**
 * 掃描線診斷 HUD — 手機上直接看得到的即時狀態浮層
 *
 * 開啟方式：網址加 `?scanline-hud=1`（開啟後記進 localStorage，
 * 站內換頁不必重帶）；關閉用 `?scanline-hud=0`。
 *
 * 為什麼不做成 DevTools 面板的一個 action：這個工具的使用場景是
 * **手機真機**——在 390px 寬的螢幕上叫出命令面板、捲到某一列按下去、
 * 再回頭看數字，本身就會打斷正在觀察的捲動行為。HUD 是常駐的，
 * 手指滑動時數值就在旁邊跳。
 *
 * 四條路徑各自對應 HUD 上的一個欄位（見 scanlineDiag 的模組註解）：
 *   1. IO 沒回呼        → CB 次數為 0 / rootBounds 與 root 高度對不上
 *   2. 慣性節流吃掉      → GAP 出現遠大於 800ms 的空窗
 *   3. 零面積不回報      → 標記列的 h=0 且 rep=✗
 *   4. 迷霧位置閘門擋下   → 標記列 fog=✗，或 FOG 段的 reach=✗
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  getDiagSnapshot,
  isDiagEnabled,
  subscribeDiag,
  type ScanlineDiagSnapshot,
} from '../progress';

import hudCss from './ScanlineHud.css?inline';
import { useDeferredStyle } from '../islands/useDeferredStyle';

/** 標記列最多顯示幾筆——手機螢幕塞不下更多，且前幾筆就足以判定 */
const MAX_ROWS = 8;

function yn(v: boolean | null): string {
  if (v === null) return '–';
  return v ? '✓' : '✗';
}

export default function ScanlineHud() {
  useDeferredStyle('scanline-hud', hudCss);
  const [snap, setSnap] = useState<ScanlineDiagSnapshot | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  /** 觀察到的最大回呼間隔——慣性空窗是瞬間發生的，當下沒看到就過去了 */
  const [maxGap, setMaxGap] = useState(0);

  useEffect(() => {
    if (!isDiagEnabled()) return undefined;
    setSnap(getDiagSnapshot());
    return subscribeDiag(() => {
      const s = getDiagSnapshot();
      setSnap(s);
      if (s.lastCallbackGap !== null) {
        setMaxGap((prev) =>
          s.lastCallbackGap! > prev ? s.lastCallbackGap! : prev
        );
      }
    });
  }, []);

  if (!isDiagEnabled() || !snap) return null;
  if (typeof document === 'undefined') return null;

  const rootMismatch =
    snap.root !== null &&
    snap.rootBoundsHeight !== null &&
    Math.abs(snap.root.clientHeight - snap.rootBoundsHeight) > 2;

  return (
    <div className={`uep-sl-hud${collapsed ? ' is-collapsed' : ''}`}>
      <button
        type="button"
        className="uep-sl-hud__bar"
        onClick={() => setCollapsed((v) => !v)}
      >
        <span>SCANLINE</span>
        <span className="uep-sl-hud__sum">
          {snap.maxIdx}/{snap.totalMarkers} · cb {snap.callbackCount}
        </span>
        <span className="uep-sl-hud__chev">{collapsed ? '▲' : '▼'}</span>
      </button>

      {!collapsed && (
        <div className="uep-sl-hud__body">
          <div className="uep-sl-hud__row">
            <b>max</b> {snap.maxIdx} <b>last</b> {snap.lastIdx} <b>total</b>{' '}
            {snap.totalMarkers}
          </div>

          <div className="uep-sl-hud__row">
            <b>cb</b> {snap.callbackCount} <b>gap</b>{' '}
            {snap.lastCallbackGap ?? '–'}ms <b>max</b>{' '}
            <span className={maxGap > 800 ? 'is-bad' : undefined}>
              {maxGap}ms
            </span>
          </div>

          {snap.root && (
            <div className="uep-sl-hud__row">
              <b>root</b> ch {snap.root.clientHeight} · sh{' '}
              {snap.root.scrollHeight} · top {snap.root.scrollTop}
            </div>
          )}

          <div className="uep-sl-hud__row">
            <b>rootBounds</b>{' '}
            <span className={rootMismatch ? 'is-bad' : undefined}>
              {snap.rootBoundsHeight ?? '–'}
              {rootMismatch ? ' ≠ root' : ''}
            </span>
          </div>

          <div className="uep-sl-hud__row uep-sl-hud__row--fog">
            <b>fog</b> {snap.fog.applies ? 'on' : 'off'}
            {snap.fog.applies && (
              <>
                {' '}
                · r {snap.fog.ratio.toFixed(3)} · acc{' '}
                {snap.fog.accum.toFixed(3)} · scr{' '}
                {snap.fog.scrollRatio.toFixed(3)}
                <br />
                <b>reach</b>{' '}
                <span
                  className={
                    snap.fog.withinReach === false ? 'is-bad' : undefined
                  }
                >
                  {yn(snap.fog.withinReach)}
                </span>{' '}
                <b>limit</b>{' '}
                <span
                  className={snap.fog.limited === null ? 'is-bad' : undefined}
                >
                  {snap.fog.limited === null
                    ? 'null'
                    : snap.fog.limited.toFixed(3)}
                </span>{' '}
                <b>n</b> {snap.fog.sampleCount}
              </>
            )}
          </div>

          <div className="uep-sl-hud__row">
            <b>sentinel</b> rep {yn(snap.sentinel.everReported)} · int{' '}
            {yn(snap.sentinel.intersecting)}
          </div>

          <table className="uep-sl-hud__table">
            <thead>
              <tr>
                <th>#</th>
                <th>top</th>
                <th>h</th>
                <th>rep</th>
                <th>int</th>
                <th>fog</th>
              </tr>
            </thead>
            <tbody>
              {snap.markers.slice(0, MAX_ROWS).map((m) => (
                <tr key={m.index}>
                  <td>{m.index}</td>
                  <td>{m.top}</td>
                  <td className={m.height === 0 ? 'is-bad' : undefined}>
                    {m.height}
                  </td>
                  <td className={m.everReported ? undefined : 'is-bad'}>
                    {yn(m.everReported)}
                  </td>
                  <td>{yn(m.intersecting)}</td>
                  <td
                    className={m.passedFogGate === false ? 'is-bad' : undefined}
                  >
                    {yn(m.passedFogGate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {snap.markers.length > MAX_ROWS && (
            <div className="uep-sl-hud__more">
              …另有 {snap.markers.length - MAX_ROWS} 個標記未列出
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { ScanlineHud };

/** 掛載到 body，避開 TopBar 的 sticky 堆疊上下文 */
export function ScanlineHudPortal() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready || typeof document === 'undefined') return null;
  return createPortal(<ScanlineHud />, document.body);
}
