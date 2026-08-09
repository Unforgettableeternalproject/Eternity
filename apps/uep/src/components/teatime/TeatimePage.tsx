/**
 * 茶會頁（S11 彩蛋）
 *
 * 從休息提醒的「前往茶會」進來會看到 U.E.P 坐在那裡喝茶；直接打網址進來
 * 只有一張空桌子和一壺茶。判定走 `consumeTeatimeInvite()`——讀到即清，
 * 重整就退回空景，這是彩蛋該有的形狀（見 `lib/teatime.ts`）。
 *
 * ## 場景是拼出來的，不是一張圖
 *
 * `teatime-table` 是高腳圓桌加茶壺，`tea-raise`／`tea-sip` 是她坐在自己那個
 * 矮台上的兩幀差分——兩者是各自獨立的物件。所以這裡讓它們**底線對齊**並排，
 * 桌子在她面向的那一側（她的臉朝左）。兩幀在轉檔階段共用裁切框，切換時
 * 只有姿勢會變，人不會跳位。
 *
 * ## 為什麼判定在 effect 而不是渲染時
 *
 * 旗標讀 sessionStorage，SSR 沒有它。在渲染時判定會讓伺服器與客戶端首次
 * 渲染不一致（hydration mismatch），而且「讀到即清」是副作用——放在渲染
 * 函式裡會被 StrictMode 的雙次呼叫吃掉那次邀請。
 */
import { useEffect, useState } from 'react';

import { consumeTeatimeInvite } from '../../lib/teatime';

import './TeatimePage.css';

/** 原始像素。兩幀同尺寸是轉檔階段共用裁切框的結果 */
const TABLE_SIZE = { width: 587, height: 1117 };
const UEP_SIZE = { width: 962, height: 1200 };

export default function TeatimePage() {
  /** null = 還沒判定。首次渲染與 SSR 一致地什麼人都不畫 */
  const [invited, setInvited] = useState<boolean | null>(null);

  useEffect(() => {
    setInvited(consumeTeatimeInvite());
  }, []);

  const leave = () => {
    // 多數情況是從 Reader 同頁導航過來的，回上一頁才回得到原本的閱讀位置
    if (window.history.length > 1) window.history.back();
    else window.location.assign('/');
  };

  return (
    <main className="tt">
      <div className="tt-eyebrow">TEA TIME</div>

      <div className={`tt-stage${invited ? ' tt-stage--served' : ''}`}>
        <img
          className="tt-table"
          src="/uep/art/teatime-table.webp"
          width={TABLE_SIZE.width}
          height={TABLE_SIZE.height}
          alt=""
          draggable={false}
        />

        {invited && (
          <div className="tt-uep">
            <img
              className="tt-frame tt-frame--raise"
              src="/uep/art/tea-raise.webp"
              width={UEP_SIZE.width}
              height={UEP_SIZE.height}
              alt="U.E.P 舉起茶杯"
              draggable={false}
            />
            <img
              className="tt-frame tt-frame--sip"
              src="/uep/art/tea-sip.webp"
              width={UEP_SIZE.width}
              height={UEP_SIZE.height}
              alt=""
              aria-hidden="true"
              draggable={false}
            />
          </div>
        )}
      </div>

      {/* 判定完成前兩段文案都不畫——先出現一段「這裡沒有人」再被抽換掉，
          比晚一拍出現難看得多 */}
      {invited !== null && (
        <p className="tt-note">
          {invited
            ? '她替你也倒了一杯。慢慢喝，讀了那麼久了。'
            : '這裡只有一張桌子，還有一壺沒人倒的茶。'}
        </p>
      )}

      <button type="button" className="tt-back" onClick={leave}>
        回到原本的地方
      </button>
    </main>
  );
}
