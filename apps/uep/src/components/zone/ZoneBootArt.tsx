/**
 * 區域入場動畫裡的 U.E.P（S11）
 *
 * 五個區域的 boot 各有各的語彙（墨暈／脈衝／閃光／掃描線／紙箱），但她
 * 出現的方式是一致的：中段浮現、留在畫面上，等 boot 整層淡出時跟著走。
 * 所以這裡只有一個元件，五個 Reader 各插一行。
 *
 * 掛在各自的 boot 容器**內**——退場靠的是父層 `.is-ready` 那道 opacity
 * transition，掛到外面就得自己再寫一套退場，而且會與 boot 的節奏脫鉤。
 */
import './ZoneBootArt.css';

/** 檔名與 zone id 同名，不需要對照表 */
export const zoneArtSrc = (zoneId: string) => `/uep/art/zone-${zoneId}.webp`;

/**
 * 立繪的預載入口。
 *
 * 從首頁或別區進來時會先經過進入前的確認卡，那時先抓好，導頁之後 boot
 * 直接用快取。直接輸入網址的話沒有這一步，靠 `fetchpriority` 爭取優先權。
 */
export function preloadZoneArt(zoneId: string) {
  if (typeof window === 'undefined') return;
  new Image().src = zoneArtSrc(zoneId);
}

export default function ZoneBootArt({ zoneId }: { zoneId: string }) {
  return (
    <img
      // 帶 zone 專屬 class：多數區域置中就好，但 concepts 的 boot 中央
      // 本來就有終端機文字，需要各自讓位
      className={`zone-boot-art zone-boot-art--${zoneId}`}
      src={zoneArtSrc(zoneId)}
      alt=""
      aria-hidden="true"
      draggable={false}
      // boot 期間畫面上沒有別的東西在等，這張圖就是那段時間唯一的內容
      {...{ fetchpriority: 'high' }}
    />
  );
}
