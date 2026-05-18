export interface ZoneData {
  id: string;
  label: string;
  slug: string;
  en: string;
  kicker: string;
  blurb: string;
  atmos: string;
  icon: string;
  glyphs: string[];
  main: string;
  soft: string;
  tint: string;
  uep: string[];
  stats: Record<string, number>;
}

export const ZONES: ZoneData[] = [
  {
    id: 'history',
    label: '歷史典藏庫',
    slug: 'history',
    en: 'History',
    kicker: 'Volume I',
    blurb: '小說、文章、篇章紀錄。書頁在無重力中編成書。',
    atmos: '書庫、年代感、敘事',
    icon: 'H',
    glyphs: ['史', '傳', '誌', '卷'],
    main: '#6B3F2A',
    soft: '#C8A46A',
    tint: 'var(--history-tint)',
    uep: [
      '很壯觀吧! 這些都是我在各個時空當中找到的故事，我很自豪喔!',
      '這些看起來像玻璃的東西叫做「回想碎片」，碰一下就會直接進到頭腦裡!',
      '那些咻咻咻飛來飛去的紙張，都在進行他們自己的「故事重導」喔!',
    ],
    stats: { 篇章: 8, 區間: 3, 子章節: 60 },
  },
  {
    id: 'echoes',
    label: '回音蒐藏間',
    slug: 'echoes',
    en: 'Echoes',
    kicker: 'Volume II',
    blurb: '音樂、OST、聲音作品。可被捧起的回憶之球。',
    atmos: '聲波、夜色、情緒',
    icon: 'E',
    glyphs: ['音', '嗚', '迴', '響'],
    main: '#355C7D',
    soft: '#6C5B7B',
    tint: 'var(--echoes-tint)',
    uep: [
      '歡迎來到充滿了世界之聲的蒐藏間，這裡聽到的全部都是實際存在的對話喔!',
      '這些球球叫做「回聲」，每一個都儲存著一段重要的回憶!',
      '藍 / 紅 / 綠 / 紫 — 每種顏色都對應到不同類型的故事，記得嗎?',
    ],
    stats: { 地點: 9, 角色組: 5, 劇情: 9, 特別: 3 },
  },
  {
    id: 'visuals',
    label: '幻影重現室',
    slug: 'visuals',
    en: 'Visuals',
    kicker: 'Volume III',
    blurb: '畫作、插圖、視覺作品。半透明的人物像在水面盪漾。',
    atmos: '影像、夢幻、展示廳',
    icon: 'V',
    glyphs: ['影', '像', '幻', '鏡'],
    main: '#5E548E',
    soft: '#9F86C0',
    tint: 'var(--visuals-tint)',
    uep: [
      '小心不要跟錯人了喔，小U.E.P可是獨一無二的!',
      '這裡是世界的印象，每一個人都曾經存在於某一個時間當中。',
      '他們是虛假幻象，但你是可以去接觸甚至仔細觀察他們的喔!',
    ],
    stats: { 畫廊: 4, 走廊: 3, 草圖: 3, AI: 2 },
  },
  {
    id: 'concepts',
    label: '概念調整房',
    slug: 'concepts',
    en: 'Concepts',
    kicker: 'Volume IV',
    blurb: '世界觀、設定文件。原質、概念、伺服器內部。',
    atmos: '研究、架構、知識',
    icon: 'C',
    glyphs: ['定', '質', '規', '理'],
    main: '#2D6A4F',
    soft: '#74C69D',
    tint: 'var(--concepts-tint)',
    uep: [
      '很科幻的房間對不對! 而且還很大 (回音: 大大大大大....)',
      '所有關於世界的概念全部都在這裡! 他們會自己去修復錯誤並逐漸變得完美!',
      '這些東西看起來像是文字，但實際上是「原質」(Essence) 喔!',
    ],
    stats: { 主機: 4, 紀錄: 12, 理論: 8, 對照: 3 },
  },
  {
    id: 'storage',
    label: '某人的置物空間',
    slug: 'storage',
    en: 'Storage',
    kicker: 'Volume V',
    blurb: '公告、Meta、雜項。一片散亂卻自有秩序的房間。',
    atmos: '個人筆記、後台、Meta',
    icon: 'S',
    glyphs: ['記', '雜', '稿', 'Σ'],
    main: '#C4A00E',
    soft: '#D5B618',
    tint: 'var(--storage-tint)',
    uep: [
      '這裡...這裡是哪裡啊? 我不記得這裡有這種房間啊?',
      '這個空間像是某個人的倉庫? 不知道是不是被其他力量所干涉而產生的。',
      '如果你對於這裡有些興趣的話，之後應該可以帶你回來的!',
    ],
    stats: { 對話: 1, 紀錄: 4, 外界: 2 },
  },
];

/**
 * 在深色模式下自動將區域主色調亮至可讀亮度（≥55% lightness）。
 * 亮色模式原色不變；只接受 6 位 hex (#rrggbb)。
 */
export function zoneTextColor(hex: string, isDark: boolean): string {
  if (!isDark || !/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (l >= 0.5) return hex; // 已夠亮
  const d = max - min;
  const s = d / (l > 0.5 ? 2 - max - min : max + min) || 0;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, 58%)`;
}

export const VERSES: string[] = [
  '萬物由最原初的質所成',
  '匯聚成個體',
  '組合成群體',
  '在有限的時間中無限的擴展著',
  '—',
  '法則隨秩序而生',
  '反饋為渾沌，卻從未曾喪失其中的平衡',
  '隨即，一條搭載著眾個體命運的宇宙被觀測',
  '概念從其中迸發，逐漸構造出世界的框架',
  '—',
  '終點與起點本是個環',
  '創世將存在賦予給個體',
  '毀滅將存在自個體之中奪去',
  '起點跟終點本是個環',
  '—',
  '聚合 跟 反饋 相輔相成',
  '創世 和 毀滅 本為同根',
  '輪迴 與 置換 相互平衡',
  '而萬物的終焉將歸約於 — 虛無',
];
