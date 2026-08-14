/**
 * 404 頁面主體。
 *
 * 沿用內容保護遮罩的斷訊語彙——找不到的頁面與看不得的頁面，對讀者來說
 * 都是「這裡觀測不到」，沒有理由讓站台在這時候換一套視覺說話。彩蛋也一併
 * 沿用：擲骰直接呼叫 `rollProtectionVariant()`，機率與遮罩共用
 * `protection.noChancePct` 站台設定，調一次兩邊同步。
 *
 * 擲骰放在 effect 而非 render：SSR 產出的一律是文字版，立繪版在 mount 後
 * 才換上去。反過來（render 期擲骰）會 hydration mismatch，而 client:only
 * 則要付出首屏空白的代價——那正是這一頁最不該有的東西。
 */

import React, { useEffect, useState } from 'react';

import {
  PROTECT_ART,
  PROTECT_ART_SIZE,
  rollProtectionVariant,
} from '../../scripts/content-protection';

export default function NotFoundPage() {
  const [variant, setVariant] = useState<'text' | 'art'>('text');

  useEffect(() => {
    setVariant(rollProtectionVariant() === 'art' ? 'art' : 'text');
  }, []);

  return (
    <div className="uep-nf" data-variant={variant}>
      <div className="uep-nf__plate">
        {variant === 'art' ? (
          <div className="uep-nf__art" aria-hidden="true">
            <img
              src={PROTECT_ART}
              width={PROTECT_ART_SIZE.width}
              height={PROTECT_ART_SIZE.height}
              alt=""
              draggable={false}
            />
          </div>
        ) : (
          <>
            <div className="uep-nf__title" data-text="觀測失效">
              觀測失效
            </div>
            <div className="uep-nf__sub">Observation Failed</div>
          </>
        )}
        <p className="uep-nf__note">
          這個座標上沒有可供觀測的紀錄。
          <br />
          網址可能有誤，或該段紀錄尚未被寫入。
        </p>
        <a className="uep-nf__back" href="/">
          返回入口
        </a>
        <div className="uep-nf__mark">UEP · 404</div>
      </div>
      <div className="uep-nf__noise" aria-hidden="true"></div>
    </div>
  );
}
