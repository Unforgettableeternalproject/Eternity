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

import { consumeTeatimeInvite, TEATIME_FLAG } from '../../lib/teatime';
import { getProgressManager } from '../../progress';

import './TeatimePage.css';

/**
 * 原始像素。同組素材的尺寸一致是轉檔階段共用裁切框的結果
 * （`frames` 群組，見 `scripts/build-uep-art.mjs`）。
 */
const TABLE_SIZE = { width: 587, height: 1117 };
const UEP_SIZE = { width: 962, height: 1200 };

/**
 * 桌子的兩種樣子：她在的時候茶壺在桌上，她不在的時候連茶壺都收走了。
 *
 * 兩張共用裁切框，所以桌子本體在畫面上的位置與大小完全相同，換圖不會位移。
 */
const TABLE_SRC = {
  served: '/uep/art/teatime-table.webp',
  empty: '/uep/art/teatime-table-empty.webp',
} as const;

export default function TeatimePage() {
  /** null = 還沒判定。首次渲染與 SSR 一致地什麼人都不畫 */
  const [invited, setInvited] = useState<boolean | null>(null);
  /** 這次之前就見過她——決定空景要用哪一種說法 */
  const [metBefore, setMetBefore] = useState(false);

  useEffect(() => {
    const served = consumeTeatimeInvite();
    /*
     * 旗標要在授旗**之前**讀。順序反過來的話「這一次見到」也會被算成
     * 「以前見過」，第一次被邀請進來的人看到的敘述就會預設他早就認識她了。
     */
    setMetBefore(getProgressManager().hasFlag(TEATIME_FLAG));
    setInvited(served);
    /*
     * 見過有人的茶會會留下旗標，供之後的劇情引用。
     *
     * 授旗綁在「真的看到她」而不是「走到這個網址」——空景那次什麼都沒
     * 發生過。旗標本身是冪等的（grantFlags 自動去重），所以不必擔心
     * StrictMode 或重複造訪。
     */
    if (served) getProgressManager().grantFlags([TEATIME_FLAG]);
  }, []);

  const leave = () => {
    // 多數情況是從 Reader 同頁導航過來的，回上一頁才回得到原本的閱讀位置
    if (window.history.length > 1) window.history.back();
    else window.location.assign('/');
  };

  return (
    <main className="tt">
      <div className="tt-eyebrow">TEA TIME</div>

      {/* 判定完成前整個場景都不畫。先擺一張桌子再抽換成另一張的話，
          被邀請的人會看到茶壺憑空冒出來——那是頁面在猶豫，不是演出 */}
      {invited !== null && (
        <div className={`tt-stage${invited ? ' tt-stage--served' : ''}`}>
          <img
            className="tt-table"
            src={invited ? TABLE_SRC.served : TABLE_SRC.empty}
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
      )}

      {/* 判定完成前三段文案都不畫——先出現一段「這裡沒有人」再被抽換掉，
          比晚一拍出現難看得多。

          空景有兩種說法，差別在讀者知不知道這裡本來有人：沒見過她的人
          走進來，這裡就只是一張桌子，「她不在」對他毫無意義（而且等於
          替他劇透了有人這件事）。 */}
      {invited !== null && (
        <p className="tt-note">
          {invited
            ? '她替你也倒了一杯。慢慢喝，讀了那麼久了。'
            : metBefore
              ? '這裡只有一張空著的桌子。她不在，連茶壺都收走了。'
              : '這裡有一張桌子，其他什麼都沒有。'}
        </p>
      )}

      <button type="button" className="tt-back" onClick={leave}>
        回到原本的地方
      </button>
    </main>
  );
}
