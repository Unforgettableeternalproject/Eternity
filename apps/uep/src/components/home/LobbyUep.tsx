/**
 * 大廳入場動畫裡的 U.E.P（S11）
 *
 * 大廳有兩個變體：亮色的速度線往上、暗色的往下。U.E.P 跟著同一個方向來——
 * 亮色從下方撐傘飄上來，暗色從上方摔下來——最後停在 Hero 主視覺的位置上。
 * overlay 淡出時她跟著淡掉，底下真正的 Hero 立繪就在同一個位置浮現，
 * 看起來像是她剛剛抵達這裡然後長大。
 *
 * ## 為什麼要即時量 Hero 的位置
 *
 * 落點必須壓在 `.home-hero-portrait` 上，而那張圖的位置隨版面、視窗寬度、
 * TopBar 高度而變，寫死任何座標都只在某一種螢幕上對。overlay 是
 * `position: fixed`，量到的 viewport 座標可以直接用。
 *
 * 大廳只有 4.2 秒，期間不重量位置——中途改變視窗大小會讓落點失準，
 * 但那個代價遠低於為此掛一組 resize 監聽。
 */
import { useLayoutEffect, useState } from 'react';

import { isTestMode } from '../../lib/apiBase';
import { getSetting } from '../../lib/uepSettings';

import './LobbyUep.css';

export const LOBBY_ART_KEY = isTestMode()
  ? 'uep.lobbyArt.v1:test'
  : 'uep.lobbyArt.v1';

/** 設定未載入時的預設機率（站台設定 `home.lobbyArtChancePct` 的權威預設） */
export const LOBBY_ART_CHANCE = 0.4;

/**
 * 第一次之後每次進站出現的機率。
 *
 * 大廳只有 4.2 秒且判定發生在最開頭，settings fetch 常常還沒回來——首訪
 * 第一頁吃到的是上面那個常數，這與其他設定鍵的契約一致（生效時機是
 * 「下一次頁面載入」）。
 */
function lobbyArtChance(): number {
  return getSetting('home.lobbyArtChancePct', LOBBY_ART_CHANCE * 100) / 100;
}

/**
 * 這次入場要不要讓她出現。
 *
 * 第一次進站必定出現——那是介紹這個角色的唯一一次保證機會；之後轉為機率制，
 * 才有「偶爾遇到」的意思。標記在第一次判定時就寫下，與實際有沒有播完無關：
 * 判定過了就算見過，否則重新整理幾次就能把「保證出現」刷成常駐。
 */
export function shouldShowLobbyArt(
  random: () => number = Math.random
): boolean {
  let seen = false;
  try {
    seen = window.localStorage.getItem(LOBBY_ART_KEY) !== null;
    if (!seen) {
      window.localStorage.setItem(LOBBY_ART_KEY, new Date().toISOString());
    }
  } catch {
    // 標記存不了（無痕模式、localStorage 被停用）就整個關掉這件事：
    // 沒有記憶的機率制不是同一個功能——「第一次必定」永遠成立，
    // 她會變成每次進站都出現的常駐元素
    return false;
  }
  return seen ? random() < lobbyArtChance() : true;
}

/**
 * 兩張立繪的原始尺寸與錨點。
 *
 * `anchorY` 是「U.E.P 本體中心」在圖高裡的位置——對齊時要對的是她本人，
 * 不是圖片的幾何中心。Float 的上半張都是傘，直接對圖心會讓她整個沉到
 * Hero 立繪下面去。
 *
 * 兩張在素材階段已經校準成本體等大（見 `scripts/build-uep-art.mjs`），
 * 所以這裡共用同一個縮放係數就能維持等大，不需要各自調整。
 */
const ART = {
  light: {
    src: '/uep/art/home-float.webp',
    width: 961,
    height: 1200,
    anchorY: 0.72,
  },
  dark: {
    src: '/uep/art/home-drop.webp',
    width: 475,
    height: 430,
    anchorY: 0.5,
  },
} as const;

/**
 * 立繪寬度相對 Hero 立繪寬度的倍率，除以 Float 的原始寬度得到共用係數。
 *
 * 刻意小於 Hero 立繪：她是路過這裡停下來，不是來取代主視覺。等大反而會讓
 * overlay 淡出時兩張圖疊成一團。
 */
const SCALE_PER_HERO_PX = 1.0 / ART.light.width;

/** 傘頂與視窗上緣至少留這麼多，看起來才不像被切掉 */
const TOP_MARGIN = 14;

/**
 * 手機版的斷點，沿用站上既有的 760px（`useDesktopIslandViewport`）。
 *
 * 手機的 Hero 是單欄，`.home-hero-portrait` 的寬度幾乎等於視窗寬——照它
 * 等寬的立繪會撐破畫面。而且單欄之後主視覺被推到標題下方，「疊在主視覺上」
 * 這個構圖本身也不成立了。
 */
const MOBILE_MAX_WIDTH = 760;

/** 手機版相對桌面算法的縮小倍率（艾斯維爾實測後定的） */
const MOBILE_SCALE = 0.4;

/** 立繪與標題之間留的間距 */
const MOBILE_GAP = 16;

/**
 * 標題下方還有一顆著陸菱形（`.lobby-diamond`），它固定在視窗的垂直中心，
 * 16px 見方轉 45° 之後半對角線約 11.3px。而標題的底邊只在中心上方 28px
 * ——只算「標題下方一點」的話，暗色那張正好落在菱形上。
 *
 * ⚠️ 不去量菱形的 rect：它著陸前的 transform 是 `-32vh`，掛載當下量到的
 * 是動畫起點而不是落點。這裡的幾何是常數，直接算比較準。
 */
const LOBBY_DIAMOND_RADIUS = 12;

/** 暗色落在菱形下方，間距給得比亮色寬一些——那一帶的東西比較密 */
const MOBILE_DROP_GAP = 24;

interface Placement {
  cx: number;
  cy: number;
  scale: number;
}

export default function LobbyUep({ isDark }: { isDark: boolean }) {
  const [placement, setPlacement] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    const hero = document.querySelector('.home-hero-portrait');
    if (!hero) return;
    const rect = hero.getBoundingClientRect();
    // 圖還沒載完時 rect 仍然正確：img 標籤帶了 width/height，版面尺寸不依賴解碼
    if (rect.width <= 0) return;

    /*
     * 手機版不疊在主視覺上，改停在**大廳自己的標題**（「邊際世界」）旁邊：
     * 亮色從下方飛上來就停在標題上方，暗色從上方摔下來就落在標題下方，
     * 各自維持原本的來向。
     *
     * ⚠️ 要對齊的是 `.lobby-title` 而不是底層的 `.home-hero-h1`——入場期間
     * 畫面上只有大廳這一層，Hero 的標題還被遮著。對錯的話兩個變體會一起
     * 往上偏，暗色甚至會落在使用者看得到的那個標題**上方**。
     *
     * 尺寸仍以主視覺的寬度為基準：標題只有四個字寬，拿它當縮放基準會把她
     * 縮成一丁點。位置與尺寸的錨點本來就不必是同一個。
     */
    const mobile = window.innerWidth <= MOBILE_MAX_WIDTH;
    const title = mobile
      ? document.querySelector('.lobby-title')?.getBoundingClientRect()
      : null;

    if (mobile && title && title.width > 0) {
      const art = isDark ? ART.dark : ART.light;
      const scale = rect.width * SCALE_PER_HERO_PX * MOBILE_SCALE;
      const height = art.height * scale;
      /*
       * 定位的是「本體中心」（transform 用 anchorY 把圖往上推），所以要自己
       * 把中心換算回圖的邊緣：Float 的圖底距中心 (1 - anchorY) 個圖高，
       * Drop 的圖頂距中心 anchorY 個圖高。
       */
      const cy = isDark
        ? // 標題與菱形都要讓過去，取兩者較低的那條線
          Math.max(
            title.bottom + MOBILE_DROP_GAP,
            window.innerHeight / 2 + LOBBY_DIAMOND_RADIUS + MOBILE_DROP_GAP
          ) +
          height * art.anchorY
        : // 傘頂不能被視窗上緣切掉。矮視窗下寧可壓到標題一點，
          // 也不要讓她只露出半截——被切掉看起來是壞掉，重疊只是擠
          Math.max(
            TOP_MARGIN + height * art.anchorY,
            title.top - MOBILE_GAP - height * (1 - art.anchorY)
          );
      setPlacement({ cx: title.left + title.width / 2, cy, scale });
      return;
    }

    const cy = rect.top + rect.height / 2;

    /*
     * 上限一律用 Float 的高度算，即使這次要畫的是 Drop。
     *
     * Hero 立繪的寬度不隨視窗高度改變，矮視窗下按寬度算出來的 Float 會把傘
     * 頂推出畫面。但若讓兩張各自被自己的高度夾，亮色縮了、暗色沒縮，兩個
     * 主題的 U.E.P 就不再等大——而等大是這組素材唯一的硬性約束。
     */
    const headroom = cy - TOP_MARGIN;
    const scale = Math.min(
      rect.width * SCALE_PER_HERO_PX,
      headroom / (ART.light.height * ART.light.anchorY)
    );

    setPlacement({ cx: rect.left + rect.width / 2, cy, scale });
    // 手機版的落點依變體而異（亮色在標題上、暗色在標題下），isDark 是真依賴
  }, [isDark]);

  if (!placement) return null;

  const art = isDark ? ART.dark : ART.light;
  const width = art.width * placement.scale;
  const height = art.height * placement.scale;

  return (
    <div
      className={`lobby-uep lobby-uep--${isDark ? 'drop' : 'float'}`}
      style={{ left: placement.cx, top: placement.cy }}
      aria-hidden
    >
      <div className="lobby-uep__bob">
        <img
          className="lobby-uep__art"
          src={art.src}
          alt=""
          width={art.width}
          height={art.height}
          style={{
            width,
            height,
            transform: `translate(-50%, ${-art.anchorY * 100}%)`,
          }}
          draggable={false}
        />
      </div>
    </div>
  );
}
