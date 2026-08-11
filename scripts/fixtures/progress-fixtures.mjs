/**
 * Epic 2 進度系統的手動驗收素材（test 環境專用）
 *
 * `scripts/seed-test-env.mjs` 的 leaf blacklist 會跳過 section／song／stuff／
 * gallery，Concepts 的 type 也只保留空殼——所以 test D1 有完整的中間結構卻
 * 一個葉子都沒有，`docs/hidden/TEST_CHECKLIST.md` 的多數項目無從驗起。
 * 本檔案補的就是那批葉子。
 *
 * ⚠️ 內容是為了觸發機制而寫的佔位敘事，與正式世界觀無關，一律以 `test-`
 * 前綴命名，方便日後整批辨識與清除。
 *
 * ⚠️ **長度是功能需求不是排場**：掃描線在視窗 80% 處，標記之間若太近，
 * 一進頁面就會整串通過，旗標、echo spot、visual clue 全部同時觸發，等於
 * 沒測到。長文的段落刻意灌到讓每個標記之間隔著數個螢幕高度。
 */

/* ── 互聯 key ───────────────────────────────────────────────── */

export const ENTITY_KEYS = {
  /** 角色：dossier 與 browser 都有他——browser profile 必須有對應 dossier 條目 */
  warden: 'test-warden',
  /** 地點：只在 dossier */
  tower: 'test-relay-tower',
  /** Echoes 場景主題曲的實體（⚠️ 只有 areas／characters cluster 掛 entityKey） */
  towerTheme: 'test-echo-tower-theme',
  /** Echoes 的第二首非劇情歌——沒有 entityKey 會被 EchoSongPicker 直接排除 */
  afterglow: 'test-echo-afterglow',
  /** Visuals 圖庫實體（⚠️ 只有陳列走廊 profiles 掛 entityKey） */
  gallery: 'test-gallery-relay',
  /**
   * 被群組 gate 擋住的 dossier 條目——「相應浮島查得到內容」的反例。
   * 探索者未持 test.reached-tower 前是普通文字，拿旗後即時變可點。
   */
  substructure: 'test-substructure',
  /**
   * 純潔者限定的 dossier 條目——唯一「當過觀測者後永久退回普通文字」
   * 的 entity，驗 S1「切回探索者不殘留可點樣式」的主力。
   */
  figure: 'test-figure',
};

export const STORY_KEYS = {
  /** 跨 History／Echoes／Visuals 三區的劇情點——驗「同 storyKey 多區都能觸發」 */
  blackout: 'test-blackout',
  /** 只掛 Echoes，驗單區錨點 */
  signal: 'test-signal',
};

/** key 說明（entity 的 title 會被 API 忽略，權威名稱來自 dossier 條目） */
export const KEY_META = [
  {
    keyType: 'entity',
    key: ENTITY_KEYS.warden,
    description:
      '測試用角色：第七中繼塔的守望者，dossier 與 browser 皆有條目。',
  },
  {
    keyType: 'entity',
    key: ENTITY_KEYS.tower,
    description: '測試用地點：訊號中繼設施，只在 dossier 有條目。',
  },
  {
    keyType: 'entity',
    key: ENTITY_KEYS.towerTheme,
    description: '測試用歌曲實體，綁在 Echoes 地點的回憶〈中繼塔主題〉。',
  },
  {
    keyType: 'entity',
    key: ENTITY_KEYS.afterglow,
    description: '測試用歌曲實體，綁在〈餘燼〉——插播後要恢復的那首。',
  },
  {
    keyType: 'entity',
    key: ENTITY_KEYS.gallery,
    description: '測試用圖庫實體，綁在 Visuals 陳列走廊〈中繼塔影像集〉。',
  },
  {
    keyType: 'entity',
    key: ENTITY_KEYS.substructure,
    description:
      '測試用受限條目：荒地下方的緻密結構，dossier 群組被 test.reached-tower gate 擋住。',
  },
  {
    keyType: 'entity',
    key: ENTITY_KEYS.figure,
    description:
      '測試用純潔者限定條目：荒地上的形狀，當過觀測者的帳號永遠查不到。',
  },
  {
    keyType: 'story',
    key: STORY_KEYS.blackout,
    title: '靜默時刻',
    description:
      '測試用劇情點：錨點橫跨 History 長文、Echoes 歌曲與 Visuals 圖庫。',
  },
  {
    keyType: 'story',
    key: STORY_KEYS.signal,
    title: '回歸訊號',
    description: '測試用劇情點：只掛 Echoes，用來對照單區錨點的行為。',
  },
];

/* ── 自訂旗標 ───────────────────────────────────────────────── */

/**
 * ⚠️ 命名避開 derived 的前綴後綴（`completed:` `met:` `gallery:` `image:`
 * `zone:visited:` `:song` `:gallery`）——`classifyFlag` 是形狀比對不是查表，
 * 撞到就會被當成規則生成而豁免註冊強制，靜默失去保護。
 */
export const FLAGS = [
  {
    name: 'test.saw-blackout',
    label: '目睹靜默時刻',
    description: '測試素材：長文中段的 FlagMarker 授予，供 gate 條件消費。',
    category: 'debug',
  },
  {
    name: 'test.reached-tower',
    label: '抵達中繼塔',
    description:
      '測試素材：長文後段的 FlagMarker 授予，供四條件全開的 gate 使用。',
    category: 'debug',
  },
];

/* ── HTML 標記組裝 ─────────────────────────────────────────── */

/** 段落 */
const p = (text) => `<p>${text}</p>`;

/** entity 標記（新格式 ref，可點與否取決於對應浮島查不查得到內容） */
export const entity = (kind, entityKey, text) =>
  `<span data-uep-entity="${kind}" data-ref="entity:${entityKey}">${text}</span>`;

/** cue 標記（媒體型引用，走路徑 ref） */
export const cue = (kind, ref, text) =>
  `<span data-uep-cue="${kind}" data-ref="${ref}">${text}</span>`;

/** FlagMarker——掃描線通過即授旗 */
const flagMarker = (flags, label) =>
  `<div data-grants-flags="${flags.join(',')}"${label ? ` data-label="${label}"` : ''} data-role="progress-marker" class="tiptap-progress-marker" aria-hidden="true"></div>`;

/** 純進度標記（不授旗，只墊高 totalMarkers） */
const plainMarker = (label) =>
  `<div${label ? ` data-label="${label}"` : ''} data-role="progress-marker" class="tiptap-progress-marker" aria-hidden="true"></div>`;

/** Echo Spot——掃描線通過時插播 */
const echoSpot = ({
  spotId,
  songId,
  songUrlKey,
  title,
  entityKey = '',
  storyKey = '',
  clusterId = '',
  songType = '',
  duration = 0,
}) =>
  `<div data-spot-id="${spotId}" data-song-id="${songId}" data-song-url-key="${songUrlKey}"` +
  (entityKey ? ` data-entity-key="${entityKey}"` : '') +
  (storyKey ? ` data-story-key="${storyKey}"` : '') +
  ` data-song-title="${title}"` +
  (clusterId ? ` data-cluster-id="${clusterId}"` : '') +
  (songType ? ` data-song-type="${songType}"` : '') +
  (duration ? ` data-duration="${duration}"` : '') +
  ` data-spoiler-level="0" data-role="echo-spot" class="tiptap-echo-spot"` +
  ` aria-label="回聲點：${title}"></div>`;

/** Visual Clue 錨點（start / gate / end 三種 edge） */
const visualClue = ({
  clueId,
  edge,
  targetType = 'entity',
  targetKey,
  galleryId,
  title = '',
  imageId = '',
  imageTitle = '',
  imageFile = '',
}) => {
  const role =
    edge === 'end'
      ? 'visual-clue-end'
      : edge === 'gate'
        ? 'visual-clue-gate'
        : 'visual-clue-start';
  const edgeLabel =
    edge === 'end' ? 'clear' : edge === 'gate' ? 'gate' : 'start';
  const label =
    edge === 'end' ? '訖點' : edge === 'gate' ? '切圖 Gate' : '起點';
  return (
    `<div data-clue-id="${clueId}" data-target-type="${targetType}"` +
    (targetKey ? ` data-target-key="${targetKey}"` : '') +
    (galleryId ? ` data-gallery-id="${galleryId}"` : '') +
    (title ? ` data-gallery-title="${title}"` : '') +
    (imageId ? ` data-image-id="${imageId}"` : '') +
    (imageTitle ? ` data-image-title="${imageTitle}"` : '') +
    (imageFile ? ` data-image-file="${imageFile}"` : '') +
    ` data-role="${role}" class="tiptap-visual-clue is-${edgeLabel}"` +
    ` aria-label="視覺線索${label}：${imageTitle || title || targetKey || '未綁定'}"></div>`
  );
};

/* ── 頁面 id ───────────────────────────────────────────────── */

const HISTORY_ARC = 'history/passage/unforgettable_story/chpt.01/arc.01';
/** 進度頁容器——底下兩篇驗繼承鏈與三層以上巢狀 */
export const PROGRESS_PAGE_ARC =
  'history/passage/unforgettable_story/chpt.01/arc.02';

export const PAGE_IDS = {
  long: `${HISTORY_ARC}/test-01-signal-tower`,
  short: `${HISTORY_ARC}/test-02-short-note`,
  gateCompleted: `${HISTORY_ARC}/test-03-gate-completed`,
  gatePristine: `${HISTORY_ARC}/test-04-gate-pristine`,
  gateAll: `${HISTORY_ARC}/test-05-gate-all`,
  inherit1: `${PROGRESS_PAGE_ARC}/test-06-inherit-a`,
  inherit2: `${PROGRESS_PAGE_ARC}/test-07-inherit-b`,
  annex: `${HISTORY_ARC}/test-08-annex`,
  /* ⚠️ Echoes 的分類**只看 cluster**（`echoes/{cluster}/…` 第二段），
     `metadata.category` 只是鏡像。放錯 cluster 的後果不是分類標籤難看，
     而是 EchoSongPicker 直接篩掉：
     - `stories` → 劇情歌，帶 storyKey
     - `areas` / `characters` → 必須有 entityKey，否則不進 picker
     - 其他 → special，一律不由 History Echo Spot 掛載 */
  songBlackout: 'echoes/stories/u.s./test-blackout-hymn',
  songSignal: 'echoes/stories/u.s./test-relay-signal',
  songTowerTheme: 'echoes/areas/ad_main/test-tower-theme',
  songAfterglow: 'echoes/areas/ad_main/test-afterglow',
  /* ⚠️ Visuals 同理，看 division（`visuals/{division}/…` 第二段）：
     entityKey 只在陳列走廊 `profiles`、storyKey 只在鑲框室 `illustrations`，
     編輯器依 division 顯隱這兩個欄位。放錯的欄位存得進 D1 但永遠不生效。 */
  galleryBlackout: 'visuals/illustrations/era_u/test-blackout-scene',
  galleryRelay: 'visuals/profiles/locations/test-relay-gallery',
  galleryWarden: 'visuals/profiles/characters/test-warden-portraits',
  stuffOpen: 'storage/boxes/test-crate-open',
  stuffLocked: 'storage/boxes/test-crate-locked',
  stuffProgression: 'storage/boxes/test-crate-progression',
  stuffPristine: 'storage/boxes/test-crate-pristine',
  conceptsDossier: 'concepts/server/records/test_entities',
  conceptsBrowser: 'concepts/server/browser/test_profiles',
  conceptsChrono: 'concepts/server/time_logs/test_timeline',
  conceptsDiff: 'concepts/server/translation/test_glossary',
};

/* ── 長文（主力素材）─────────────────────────────────────── */

const W = (text) => entity('character', ENTITY_KEYS.warden, text);
const T = (text) => entity('location', ENTITY_KEYS.tower, text);

/**
 * 段落之間的「填充」——單純為了把標記彼此推開。
 * 每組約六段、合計五百字上下，在一般桌面視窗約佔兩個螢幕高度。
 */
const filler = (lines) => lines.map(p).join('');

const OPENING = filler([
  '訊號是在第三個夜晚斷掉的。',
  `不是突然斷的。它先是慢下來，像有人把一段旋律逐格拉長，每個音之間的空隙越張越開，開到你以為那是靜止，然後下一個音才姍姍來遲地落下。${T('第七中繼塔')}的值班紀錄上寫著「輕微延遲」，字跡工整，看不出寫的人當時已經連續值了三十六個小時。`,
  '塔的內部比外面看起來窄。外牆是為了抗風而做的圓筒，內部卻被隔成七層方形的房間，每一層都只有一道朝北的窗。從窗口望出去，能看見的東西年復一年沒有變過：一片被風壓平的荒地，遠處一列鏽掉的輸電塔，以及天空。',
  '天空是唯一會變的東西。',
  `${W('凱蘭·佛斯特')}在第四層待了十一年。他來的時候塔裡還有六個人，走的時候——如果他真的會走的話——大概只會剩下他自己。人一個一個被調走，理由都很正當：中繼站的自動化程度提高了，人力該投到更需要的地方去。`,
  '沒有人問過留下來的那個人怎麼想。',
  /* 這幾段沒有承載任何機制，純粹是把第一個 FlagMarker 推出首屏。
     標記太靠前的話，頁面一載入掃描線就已經越過它，旗標在讀者還沒開始
     捲動時就授出去了——那等於什麼都沒測到。 */
  '值班的日子有一種特定的形狀。早上六點交接——雖然沒有人可以交接了，這個動作還是保留著，寫在流程手冊上，他照做——然後是設備巡檢，一層一層往上走，每層停留的時間都固定。第七層最快，因為那裡只有天線基座和一堆纜線；第二層最慢，因為那裡的濕度計壞了三年，每次都要用手動的方式量。',
  '巡檢完是早餐。早餐之後是紀錄整理，把前一天的自動日誌抄成人看得懂的摘要，這件事其實沒有必要——日誌本身就存在系統裡——但流程手冊要求，他也就照做。',
  '中午之後的時間是空的。',
  '真正的空。不是「沒有安排」的那種空，而是「不知道該怎麼填」的那種空。他試過看書，塔裡有前幾任留下來的一箱平裝本，大部分他都讀過兩遍以上。他試過修東西，但能修的都修完了。他試過寫東西，寫了三頁就停下來，因為不知道要寫給誰看。',
  '最後他選擇了看窗外。',
  '這聽起來很消極，但實際上不是。看久了你會發現荒地並不是靜止的——草會依風向排成不同的紋路，光線在一天之內會走過整片地面，遠處輸電塔的影子每個季節的長度都不一樣。這些東西構成一種極慢的敘事，慢到需要用月為單位才讀得出來。',
  '他讀了十一年。',
]);

const AFTER_FIRST_MARKER = filler([
  '延遲變成中斷的那一刻，凱蘭正在煮水。',
  '他記得很清楚，因為水快滾了。壺底開始發出那種細碎的、像沙子摩擦的聲音，他伸手要去關火，然後整棟塔安靜下來。',
  '不是「變安靜」。是「安靜下來」——那些你從來不會注意到的聲音，通風管的低鳴、電源櫃的嗡嗡聲、某層樓某扇沒關緊的門在風裡輕輕碰撞的節奏，全部在同一瞬間消失。剩下的只有水快滾了的聲音，而那個聲音突然變得非常大。',
  '他站在那裡數了十二秒。',
  '第十三秒，通風管重新開始低鳴，電源櫃恢復嗡嗡聲，那扇門又碰了一下。一切回到原位，彷彿剛才什麼都沒發生。壺子滾了，他關掉火。',
  '值班紀錄上他寫：「02:14，全塔靜默約十二秒，原因不明，設備自行恢復。」寫完他盯著那行字看了很久，覺得自己漏掉了什麼，但想不出來是什麼。',
  '他漏掉的是：那十二秒裡，他沒有聽見自己的心跳。',
]);

const BEFORE_ECHO = filler([
  '第二次靜默發生在四天後，持續了四十秒。',
  '這次他有準備。他在桌上放了一支老式的機械碼表，靜默一開始就按下去。碼表的秒針照常走動——機械的東西不受影響，這讓他鬆了一口氣，又讓他更不安。',
  '四十秒裡他做了一件事：他走到窗邊，看外面。',
  '荒地還在，輸電塔還在，天空還在。但有什麼不對。他花了大半的時間才意識到不對在哪裡——風停了。不是風變小，是那片被風壓平了幾十年的草地，每一根草都靜止在它們最後被吹倒的角度上，像一張照片。',
  '然後風回來了，草地重新開始起伏，碼表停在四十一秒。',
  '他回到桌邊，發現自己的手在抖。',
]);

const AFTER_ECHO = filler([
  '塔裡有一台舊的收音機，前一任值班員留下來的，沒有人知道它還能不能用。凱蘭第一次插上電是在第三次靜默之後。',
  '它能用。但它收不到任何電台——這裡離最近的發射站有兩百多公里，本來就不該收得到。他把旋鈕從一端慢慢轉到另一端，聽了整整一個小時的白噪音，然後在最低頻的地方停下來。',
  '那裡有東西。',
  '很微弱，微弱到必須把耳朵貼在喇叭上才聽得見。是一段旋律，或者說是一段旋律的殘骸——只有輪廓，沒有細節，像隔著很厚的牆聽別人哼歌。它重複，大約每四十秒一次。',
  '四十秒。',
  `他把那段聲音錄了下來，錄在一卷不知道從哪裡翻出來的舊磁帶上。之後的很多個晚上，他會在值完班之後把它放出來聽，一遍又一遍。他知道那是${entity('term', ENTITY_KEYS.towerTheme, '某種訊號')}，但他不知道是誰發的，也不知道發給誰。`,
  // cue（媒體型引用）與 entity（文字型）互斥且行為不同——各留一個驗 dispatcher
  `檔案庫後來把那卷磁帶編了號，附註欄寫著${cue('song', PAGE_IDS.songBlackout, '〈靜默讚歌〉')}，來源不明。`,
]);

const BEFORE_CLUE = filler([
  '第七次靜默之後，他開始拍照。',
  '塔裡有一台配發的舊相機，本來是用來記錄設備損壞情況的，膠卷還剩大半卷。他把它架在第四層的窗邊，鏡頭朝外，快門線拉到桌邊。靜默一開始，他就按下去。',
  '第一張沖出來是全白的。第二張也是。到第五張他才明白過來——靜默的時候，外面的光也不對。不是變暗或變亮，是變得沒有方向，所有東西都不投影子，整片荒地平得像一張沒有畫完的草稿。',
  '第六張拍到了東西。',
  '就在輸電塔那一列的最遠端，畫面邊緣，有一個站著的形狀。',
  '他把照片放大又放大，直到顆粒糊成一團也看不出更多。那個形狀太遠了，遠到不可能是人——那個距離的人在膠卷上會小到看不見。但它就在那裡，站著，面朝塔。',
]);

const MID_CLUE = filler([
  '他沒有把這件事寫進值班紀錄。',
  '不是因為害怕被當成瘋子——雖然這也是理由之一——而是因為他不知道該怎麼寫。「發現不明形狀」聽起來像設備誤判，「有人站在荒地上」聽起來像他看錯了，而這兩件事都不是他真正想說的。',
  '他真正想說的是：它在看著這裡。',
  '這句話寫在紀錄上會很難看。所以他把照片收進抽屜，繼續值班，繼續在每次靜默的時候按下快門。',
  '膠卷用完的那天是第十九次靜默。他把整卷送去沖洗——這意味著要等下一次補給車來，來回大概三週。三週裡他沒有再拍到任何東西，因為沒有底片了，而靜默還在繼續，頻率越來越高。',
]);

const AFTER_CLUE = filler([
  '照片沖回來的時候是一整疊。',
  '他坐在第四層的桌邊，一張一張看過去。前面幾張是全白，中間有幾張拍到了那個形狀，位置每次都不太一樣——有時候在輸電塔那一端，有時候更近一些，有一張裡它已經越過了荒地的中線。',
  '最後一張是滿版的臉。',
  '不是貼在鏡頭上的那種滿版。是它站在窗外，隔著玻璃，剛好填滿整個畫面的那種滿版。它沒有五官，或者說它的五官是荒地和天空——你能透過那張臉看見背後的東西，就像看一片非常薄的水。',
  '拍那張照片的那天，值班紀錄上寫著：「07:41，全塔靜默三分十二秒，原因不明，設備自行恢復。無異常。」',
  '無異常。他當時真的這麼認為。',
]);

const BEFORE_SECOND_MARKER = filler([
  '之後的事情變得很難按順序講。',
  '他還是照常值班，照常寫紀錄，照常在補給車來的時候簽收。他和司機聊天，聊天氣，聊路況，聊司機的女兒剛上學。一切都很正常，正常到有時候他會懷疑照片是不是自己想像出來的。',
  '然後他會打開抽屜，照片還在。',
  '靜默的間隔縮短到一天兩三次，每次幾分鐘。他不再拍照了——不是因為底片用完，補給車帶了新的來——而是因為他發現了更值得記錄的事情。',
  '靜默的時候，塔裡多了一個腳步聲。',
  '不是他的。他數過：他站著不動，那個腳步聲照常，一步一步，從第七層往下走，每次都在第五層停住。從來沒有下到第四層過。',
]);

const AFTER_SECOND_MARKER = filler([
  '他在第五層等過。',
  '總共等了十一次。前十次什麼都沒有——他站在樓梯口，聽著腳步聲從上面下來，越來越近，然後在他面前三公尺的地方停住，接著靜默結束，聲音消失。',
  '第十一次，它沒有停。',
  `那天他寫的值班紀錄只有一行字，字跡潦草到後來的調查人員花了很久才辨認出來：「它認得我。」`,
  '之後的紀錄本是空白的。不是被撕掉，是真的沒有再寫過——後面幾十頁都是乾淨的，紙張因為潮氣有點發皺，但沒有任何墨跡。',
  `${T('第七中繼塔')}在那之後又運作了四年，全自動，沒有人員配置。四年裡它一次故障都沒有出過，訊號穩定得反常。`,
]);

const BEFORE_LAST_ECHO = filler([
  '調查是在第五年開始的，起因是一份例行的設備汰換評估。',
  '評估人員進塔的時候發現第四層的門是從裡面反鎖的。撬開之後，裡面的東西都在原位：桌子、碼表、收音機、那台相機、一疊照片、一卷磁帶，以及那本從第十一次之後就沒再寫過的值班紀錄。',
  '沒有凱蘭·佛斯特。',
  '也沒有任何他離開的紀錄——塔的出入系統完整保存著五年的日誌，最後一筆進出是他在第十一次靜默那天早上出去巡檢，然後回來。之後沒有任何一筆。',
  `照片被封存了，磁帶也是——那批影像後來以${entity('term', ENTITY_KEYS.gallery, '中繼塔影像集')}的名義單獨建檔。收音機被列為「無使用價值」報廢，碼表下落不明。`,
  `歸檔清單上另外附了一張${cue('image', PAGE_IDS.galleryRelay, '現場照片')}，拍的是第四層那扇窗，從外面。`,
  '那本值班紀錄最後歸檔的時候，有人在封面上加了一行字：「內容不完整，僅供參考。」',
]);

const ENDING = filler([
  '磁帶在檔案庫裡放了很多年，直到某次整理才被重新播放。',
  '裡面的東西和凱蘭當年錄下的一樣：一段微弱的、每四十秒重複一次的旋律殘骸。技術人員做了頻譜分析，結論是「疑似設備底噪，無有效訊息」。',
  '報告寫完歸檔，事情就這樣結束了。',
  '只有一個細節沒有寫進報告：做分析的那位技術人員，在聽完整卷磁帶之後，請了三天假。回來上班的第一件事，是把自己辦公室的窗簾換成了不透光的那種。',
  '有人問她為什麼。',
  '她說沒什麼，只是覺得最近的光太亮了。',
]);

/** 長文 A 的完整 HTML */
export const LONG_ARTICLE_HTML = [
  OPENING,
  flagMarker([FLAGS[0].name], '目睹靜默'),
  AFTER_FIRST_MARKER,
  BEFORE_ECHO,
  echoSpot({
    spotId: 'test-spot-hymn',
    songId: PAGE_IDS.songBlackout,
    songUrlKey: 'audio/test-blackout-hymn.mp3',
    title: '靜默讚歌',
    // 劇情歌只帶 storyKey——EchoSongPicker 依 cluster 二擇一輸出
    storyKey: STORY_KEYS.blackout,
    clusterId: 'echoes/stories',
    songType: 'story',
    duration: 154,
  }),
  AFTER_ECHO,
  BEFORE_CLUE,
  visualClue({
    clueId: 'test-clue-relay',
    edge: 'start',
    targetType: 'story',
    targetKey: STORY_KEYS.blackout,
    galleryId: PAGE_IDS.galleryBlackout,
    title: '中繼塔影像集',
    imageId: 'test-img-tower',
    imageTitle: '靜默中的塔',
    imageFile: 'images/test-relay-tower.png',
  }),
  MID_CLUE,
  visualClue({
    clueId: 'test-clue-relay',
    edge: 'gate',
    targetType: 'story',
    targetKey: STORY_KEYS.blackout,
    galleryId: PAGE_IDS.galleryBlackout,
    imageId: 'test-img-figure',
    imageTitle: '荒地上的形狀',
    imageFile: 'images/test-figure.png',
  }),
  AFTER_CLUE,
  visualClue({
    clueId: 'test-clue-relay',
    edge: 'end',
    targetType: 'story',
    targetKey: STORY_KEYS.blackout,
    galleryId: PAGE_IDS.galleryBlackout,
  }),
  BEFORE_SECOND_MARKER,
  flagMarker([FLAGS[1].name], '抵達中繼塔'),
  AFTER_SECOND_MARKER,
  BEFORE_LAST_ECHO,
  echoSpot({
    spotId: 'test-spot-signal',
    songId: PAGE_IDS.songSignal,
    songUrlKey: 'audio/test-relay-signal.mp3',
    title: '中繼訊號',
    storyKey: STORY_KEYS.signal,
    clusterId: 'echoes/stories',
    songType: 'story',
    duration: 98,
  }),
  ENDING,
  visualClue({
    clueId: 'test-clue-warden',
    edge: 'start',
    targetType: 'entity',
    targetKey: ENTITY_KEYS.warden,
    galleryId: PAGE_IDS.galleryWarden,
    title: '守望者影像',
    imageId: 'test-img-warden',
    imageTitle: '值班中的凱蘭',
    imageFile: 'images/test-warden.png',
  }),
  filler([
    '關於凱蘭·佛斯特這個人，留下來的影像只有三張，全部來自人事檔案。',
    '第一張是入職照，年份很早，照片裡的人看起來比實際年齡年輕，表情有點僵硬，像是不習慣被拍。第二張是中途的例行更新，同一個角度，同一種僵硬，只是眼睛下方多了兩道陰影。',
    '第三張沒有日期。',
    '那張照片不是在攝影棚拍的，背景是塔裡第四層的那扇窗。他坐在桌邊，側對鏡頭，沒有看向任何地方。窗外是荒地和天空，光線平得沒有方向，地上的東西都不投影子。',
    '沒有人知道那張照片是誰拍的。',
  ]),
  visualClue({
    clueId: 'test-clue-warden',
    edge: 'end',
    targetType: 'entity',
    targetKey: ENTITY_KEYS.warden,
    galleryId: PAGE_IDS.galleryWarden,
  }),
  filler([
    '檔案的最後附了一份手寫的備註，紙張和其他文件不同，看起來是後來夾進去的。',
    '上面只有兩句話：',
    '「第七中繼塔目前仍在運作，訊號穩定。」',
    '「建議不要派人。」',
  ]),
  plainMarker('尾聲'),
  filler([
    '塔還在那裡。',
    '從公路上經過的時候能看見它——一根圓筒，七層樓高，外牆的漆掉了大半，朝北的那一列窗戶在白天會反光。晚上不反光，因為裡面沒有燈。',
    '不對，有一層有燈。',
    '第四層。',
  ]),
].join('');

/* ── 其餘 History 短篇 ─────────────────────────────────────── */

/** 無 `hr`、無任何標記的短文——專測文末哨兵的完成判定 */
export const SHORT_ARTICLE_HTML = filler([
  '補給車的司機叫蜜拉·凡登，跑這條線跑了七年。',
  '她對第七中繼塔的印象只有兩件事：一是那條路最後八公里沒有鋪柏油，車會一直跳；二是值班的那個人每次都會出來幫忙搬東西，話不多，但會記得她上次說過什麼。',
  '有一次她提到女兒剛上學，隔了三個月再去，他問的第一句話是「妹妹習慣了嗎」。',
  '她那時候覺得這個人只是安靜，不是孤僻。',
  '最後一次送補給是在春天。東西照常卸完，簽收單照常簽名，她要走的時候他叫住她，說了一句沒頭沒尾的話。',
  '他說：「如果下次來我不在，門是鎖著的話，就不要開。」',
  '她當時笑了，以為是玩笑。',
]);

export const GATE_COMPLETED_HTML = filler([
  '這是接在長文之後才讀得到的段落。',
  '調查報告的附件裡有一份設備日誌的節錄，涵蓋最後那三個月。日誌本身枯燥得驚人——電壓、溫度、訊號強度，每十五分鐘一筆，密密麻麻幾百頁。',
  '有人把靜默發生的時間點標了出來，做成一張圖。',
  '圖上的點一開始稀疏，往右逐漸密集，到最後三週幾乎連成一條線。而在那條線的末端，也就是第十一次之後，所有的點突然消失。',
  '設備日誌顯示：從那一天起，靜默再也沒有發生過。',
  '訊號穩定得反常，一次故障都沒出過，持續四年。',
]);

export const GATE_PRISTINE_HTML = filler([
  '這一段只有從未見證過一切的人讀得到。',
  '有一種說法，在檔案庫裡流傳過一陣子，沒有任何證據，也從來沒有寫進任何報告。',
  '說法是這樣的：第七中繼塔從來就不是中繼塔。',
  '它的位置不對——真正需要中繼的路線不經過那片荒地，繞過去反而更短。它的高度也不對，七層樓對那個海拔沒有意義。它唯一符合中繼塔規格的地方，是外觀。',
  '如果它不是中繼塔，那麼它是什麼？',
  '有人說它是一根釘子。',
  '把某個東西釘在那裡，不讓它移動。而值班員的工作，從來就不是值班。',
]);

export const GATE_ALL_HTML = filler([
  '四個條件都通過才會出現的段落。',
  '磁帶被重新分析過第二次，那是很多年之後的事了，用的是完全不同世代的設備。',
  '這次的結論和第一次不一樣。',
  '那段每四十秒重複一次的旋律殘骸，被還原出了完整的頻率結構。它不是底噪，也不是任何已知的設備干擾——它是一段人聲，被壓縮到極限，速度放慢了大約兩百倍。',
  '還原之後，那段人聲只有兩個字，重複了整整一卷磁帶。',
  '「還在。」',
]);

export const INHERIT_A_HTML = filler([
  '這一篇在被標為進度頁的容器底下，用來驗繼承鏈。',
  '關於荒地本身，地質報告的說法是「長期風蝕的平原，無特殊構造」。',
  '報告附的鑽探紀錄顯示，地下十二公尺處有一層異常緻密的物質，鑽頭在那裡磨損得特別快。負責的工程師在備註欄寫了「疑似人工結構」，之後這句話被劃掉了，改成「疑似沉積岩層」。',
  '劃掉的筆跡和改寫的筆跡不是同一個人的。',
]);

export const INHERIT_B_HTML = filler([
  '同一個容器底下的第二篇。',
  '輸電塔那一列在圖資上總共有十四座，編號從南到北。',
  '但實地清點的時候是十五座。',
  '多出來的那一座沒有編號，沒有電纜，結構和其他十四座完全相同。它立在那裡，什麼也沒有連著。',
  '維護單位的說法是「早年施工的備用件，後來沒有拆」。',
  '沒有人解釋為什麼備用件會被立起來。',
]);

/* ── 附錄長文（受限 entity + met: fallback 專用）──────────────
 *
 * 主力長文的標記節奏經過調校，不動它——這一篇獨立承擔三種主力沒有的
 * entity 狀態（Ariel 2026-08-12 回饋：素材裡沒有任何被 gate 的 entity，
 * S1／S4 的鎖定鏈無從驗起）：
 *
 * 1. 舊格式路徑 ref：唯一消費 `met:{完整 ref}` 旗標的 entity。文中先出現
 *    （普通文字），捲過認識點的 FlagMarker 後應即時變可點。met:* 是
 *    derived 旗標，豁免註冊強制，不進 FLAGS。
 * 2. 群組 gate 條目（test-substructure）：未持 test.reached-tower 前是
 *    普通文字，讀完主力長文拿旗後回來看應已可點。
 * 3. 純潔者限定條目（test-figure）：純潔探索者可點；一旦當過觀測者，
 *    切回後必須退回普通文字且永不恢復——S1「不殘留可點樣式」的判定。
 */

/** 舊格式 ref 指向實體名錄頁本身——met: fallback 的消費對象 */
export const LEGACY_ENTITY_REF = PAGE_IDS.conceptsDossier;

/** 舊格式（路徑型 ref）entity 標記——`entity()` 只組新格式，這裡自組 */
const legacyEntity = (kind, ref, text) =>
  `<span data-uep-entity="${kind}" data-ref="${ref}">${text}</span>`;

const ANNEX_OPENING = filler([
  '調查結束之後，卷宗並沒有闔上。',
  '第七中繼塔的檔案在歸檔系統裡被拆成了兩份：一份是正卷，編號齊全，任何人都調得到；另一份是附錄，沒有編號，存放位置的欄位寫著「另行保管」。',
  '附錄的存在本身不是秘密。正卷的目錄最後一行就列著它，像一扇看得見但沒有把手的門。',
  '申請調閱的人不少。批准的紀錄一筆都沒有。',
  '負責保管的部門換過三次名字，職掌越改越模糊，最後一次改組之後，它在組織圖上的位置變成了一條虛線。虛線的另一端沒有連著任何東西。',
  '有人說那是行政疏失。也有人說，虛線畫成那樣才是準確的。',
]);

const ANNEX_BEFORE_MET = filler([
  '能確定的只有一件事：附錄裡的東西曾經被整理過。',
  '整理的痕跡藏在正卷裡——某些段落的敘述順序不自然，像是繞開了什麼；某些照片的編號跳號，跳過的號碼加起來剛好是一卷膠卷的張數。',
  '做過檔案工作的人一眼就看得出來：這不是遺失，是抽走。',
  '抽走的東西去了哪裡，正卷當然不會寫。但抽走這個動作本身留下了形狀，就像從書架上拿走一本書，留下的空隙會告訴你它有多厚。',
  '那個空隙很厚。',
]);

const ANNEX_AFTER_MET = filler([
  '認識了索引的形狀之後，再回頭讀正卷，很多段落會變得不一樣。',
  '之前讀起來只是節奏怪異的句子，現在能看出斷口在哪裡；之前以為是排版錯誤的空行，現在知道那裡原本有一張照片。',
  '閱讀這件事，有時候不是往前推進，而是回頭重讀。',
  '同一份文件，第二次讀的人和第一次讀的人，拿到的東西不一樣。這不是文件變了，是讀的人變了。',
  '附錄的保管者大概很清楚這一點。所以他們抽走的從來不是結論，而是讓人變成「第二次讀的人」的那些東西。',
]);

const ANNEX_ENDING = filler([
  '附錄的最後一頁是一張借閱單，格式老舊，手寫。',
  '借閱人欄位的字跡被水漬暈開了，讀不出來。日期欄是空的。事由欄只寫了兩個字：「核對」。',
  '沒有人知道核對的結果。',
  '只知道那張借閱單之後，附錄再也沒有新增過任何一頁。',
]);

/** 附錄長文的完整 HTML */
export const ANNEX_HTML = [
  ANNEX_OPENING,
  p(
    `拆分的依據找不到明文規定，唯一的線索是${legacyEntity(
      'term',
      LEGACY_ENTITY_REF,
      '原始檔案索引'
    )}——一份用舊制編目寫成的清單，正卷引用過它三次，每次都只引編號不引內容。`
  ),
  p(
    `清單裡有一個反覆出現的條目。地質報告裡被劃掉又改寫的那行備註指的就是它：${entity(
      'location',
      ENTITY_KEYS.substructure,
      '荒地下方的結構'
    )}。改寫的人大概以為劃掉就夠了。`
  ),
  ANNEX_BEFORE_MET,
  // 認識點：捲過即授 met: 旗標，上方的舊格式 entity 應即時變可點
  flagMarker([`met:${LEGACY_ENTITY_REF}`], '認識點・檔案索引'),
  ANNEX_AFTER_MET,
  p(
    `至於照片邊緣那個${entity(
      'character',
      ENTITY_KEYS.figure,
      '荒地上的形狀'
    )}，附錄裡收了一份手寫的觀察備忘。備忘的結論欄是空的——寫的人似乎認為，看過答案的人不該再回來讀這一條。`
  ),
  ANNEX_ENDING,
].join('');

/* ── 頁面定義 ───────────────────────────────────────────────
 *
 * `content` 一律是 ContentBlock[]，`metadata` 的形狀依 page_type 而異。
 * gate 走 `metadata.gate`，進度頁走 `metadata.progressPage`（與 gate 同層平鋪）。
 */

const richText = (html) => [
  { id: 'content', type: 'rich_text', content: html },
];

export const HISTORY_PAGES = [
  {
    id: PAGE_IDS.long,
    title: '[測試] 第七中繼塔',
    pageType: 'section',
    sortOrder: 90,
    content: richText(LONG_ARTICLE_HTML),
    metadata: { icon: 'tower-broadcast' },
  },
  {
    id: PAGE_IDS.short,
    title: '[測試] 補給車司機的證詞',
    pageType: 'section',
    sortOrder: 91,
    // 刻意不放任何 hr 與標記——完成判定只能靠文末哨兵
    content: richText(SHORT_ARTICLE_HTML),
    metadata: { icon: 'truck' },
  },
  {
    id: PAGE_IDS.gateCompleted,
    title: '[測試] 閘門・需先讀完長文',
    pageType: 'section',
    sortOrder: 92,
    content: richText(GATE_COMPLETED_HTML),
    metadata: {
      icon: 'lock',
      gate: { requiresFlags: [`completed:${PAGE_IDS.long}`] },
    },
  },
  {
    id: PAGE_IDS.gatePristine,
    title: '[測試] 閘門・純潔者限定',
    pageType: 'section',
    sortOrder: 93,
    // 唯一連觀測者都擋得住的條件，單獨一頁才驗得乾淨
    content: richText(GATE_PRISTINE_HTML),
    metadata: { icon: 'eye-slash', gate: { pristineOnly: true } },
  },
  {
    id: PAGE_IDS.gateAll,
    title: '[測試] 閘門・四條件全開',
    pageType: 'section',
    sortOrder: 94,
    /* 四維是 AND 聯集：進度頁繼承（父容器 arc.01 不是進度頁，故此頁靠
       自身三項）+ 需先讀完 + 自訂旗標 + 純潔者限定。UI 上四項都必須看得見，
       絕不可條件隱藏其中任何一項。 */
    content: richText(GATE_ALL_HTML),
    metadata: {
      icon: 'lock-keyhole',
      gate: {
        requiresFlags: [
          `completed:${PAGE_IDS.long}`,
          FLAGS[0].name,
          FLAGS[1].name,
        ],
        pristineOnly: true,
      },
    },
  },
  {
    id: PAGE_IDS.inherit1,
    title: '[測試] 繼承・荒地的地質報告',
    pageType: 'section',
    sortOrder: 95,
    content: richText(INHERIT_A_HTML),
    metadata: { icon: 'layer-group' },
  },
  {
    id: PAGE_IDS.inherit2,
    title: '[測試] 繼承・第十五座塔',
    pageType: 'section',
    sortOrder: 96,
    content: richText(INHERIT_B_HTML),
    metadata: { icon: 'layer-group' },
  },
  {
    id: PAGE_IDS.annex,
    title: '[測試] 附錄・受限檔案',
    pageType: 'section',
    sortOrder: 97,
    content: richText(ANNEX_HTML),
    metadata: { icon: 'folder-tree' },
  },
];

/* ── Echoes ────────────────────────────────────────────────
 *
 * song 的資料全在 metadata；content 是空的 rich_text（與正式資料一致）。
 * audioFile 指向 test R2 的裸 key——檔案由艾斯維爾後補，缺檔時前台會顯示
 * 載入失敗但不影響 spot 觸發、佇列與插播的驗證。
 */

export const ECHOES_PAGES = [
  /* ── 劇情的回憶（stories）：songType = story，帶 storyKey ── */
  {
    id: PAGE_IDS.songBlackout,
    title: '[測試] 靜默讚歌',
    pageType: 'song',
    sortOrder: 90,
    content: richText(''),
    metadata: {
      subtitle: '第七中繼塔',
      // category 是 cluster 的鏡像，唯讀——這裡必須與 stories 推導的結果一致
      category: 'story',
      spoilerLevel: 0,
      audioFile: 'audio/test-blackout-hymn.mp3',
      audioMeta: {
        duration: 154,
        format: 'mp3',
        title: 'Hymn of Silence',
        artist: 'Test Fixture',
        album: 'Progress System Fixtures',
      },
      appreciation: [
        '每四十秒重複一次的旋律殘骸，錄在一卷不知道從哪裡翻出來的舊磁帶上。',
      ],
      // 劇情歌只掛 storyKey——與 Visuals 鑲框室共用同一個劇情點
      storyKey: STORY_KEYS.blackout,
    },
  },
  {
    id: PAGE_IDS.songSignal,
    title: '[測試] 中繼訊號',
    pageType: 'song',
    sortOrder: 91,
    content: richText(''),
    metadata: {
      subtitle: '荒地',
      category: 'story',
      spoilerLevel: 0,
      audioFile: 'audio/test-relay-signal.mp3',
      audioMeta: {
        duration: 98,
        format: 'mp3',
        title: 'Relay Signal',
        artist: 'Test Fixture',
        album: 'Progress System Fixtures',
      },
      appreciation: ['訊號穩定得反常，一次故障都沒有出過。'],
      // 只掛 Echoes 的劇情點，對照 blackout 的跨區行為
      storyKey: STORY_KEYS.signal,
    },
  },
  /* ── 地點的回憶（areas）：songType = area，**必須**有 entityKey ── */
  {
    id: PAGE_IDS.songTowerTheme,
    title: '[測試] 中繼塔主題',
    pageType: 'song',
    sortOrder: 90,
    content: richText(''),
    metadata: {
      subtitle: '第七中繼塔',
      category: 'area',
      spoilerLevel: 0,
      audioFile: 'audio/test-tower-theme.mp3',
      audioMeta: {
        duration: 132,
        format: 'mp3',
        title: 'Relay Tower Theme',
        artist: 'Test Fixture',
        album: 'Progress System Fixtures',
      },
      appreciation: ['場景主題曲——用來驗非劇情歌的 entity 引用路徑。'],
      entityKey: ENTITY_KEYS.towerTheme,
    },
  },
  {
    id: PAGE_IDS.songAfterglow,
    title: '[測試] 餘燼',
    pageType: 'song',
    sortOrder: 91,
    content: richText(''),
    metadata: {
      subtitle: '檔案庫',
      category: 'area',
      spoilerLevel: 0,
      audioFile: 'audio/test-afterglow.mp3',
      audioMeta: {
        duration: 211,
        format: 'mp3',
        title: 'Afterglow',
        artist: 'Test Fixture',
        album: 'Progress System Fixtures',
      },
      appreciation: ['「使用者原本在播的曲子」——驗插播結束後能不能正確恢復。'],
      // 非劇情歌沒有 entityKey 會被 EchoSongPicker 篩掉，即使只是手動播放用
      entityKey: ENTITY_KEYS.afterglow,
    },
  },
];

/* ── Visuals ───────────────────────────────────────────────
 *
 * images[] 的 file 是 R2 裸 key。第四張掛 gate，驗「未解鎖圖片佔位可見」
 * （與 Echoes 完全隱藏刻意相反）。
 */

export const VISUALS_PAGES = [
  /* ── 鑲框室（illustrations）：只有這裡掛 storyKey，Visual Clue 的 story 型
        目標一定在這一館 ── */
  {
    id: PAGE_IDS.galleryBlackout,
    title: '[測試] 靜默時刻的紀錄',
    pageType: 'gallery',
    sortOrder: 90,
    content: richText(''),
    metadata: {
      icon: 'tower-broadcast',
      description: '值班期間拍下的照片，膠卷沖洗後才發現拍到了東西。',
      group: '測試素材',
      spoilerLevel: 0,
      layout: 'pinboard',
      // 與 Echoes〈靜默讚歌〉共用同一個劇情點——同一個 storyKey 同時掛歌與插圖
      storyKey: STORY_KEYS.blackout,
      images: [
        {
          id: 'test-img-tower',
          file: 'images/test-relay-tower.png',
          caption: '靜默中的塔',
          sortOrder: 0,
        },
        {
          id: 'test-img-figure',
          file: 'images/test-figure.png',
          caption: '荒地上的形狀',
          sortOrder: 1,
        },
        {
          id: 'test-img-window',
          file: 'images/test-window.png',
          caption: '第四層朝北的窗',
          sortOrder: 2,
        },
        {
          id: 'test-img-locked',
          file: 'images/test-locked.png',
          caption: '最後一張',
          sortOrder: 3,
          // 未解鎖的圖：佔位要看得見，內容不可見
          gate: { requiresFlags: [FLAGS[1].name] },
        },
      ],
    },
  },
  /* ── 陳列走廊（profiles）：只有這裡掛 entityKey，長文的 entity span 與
        Visual Clue 的 entity 型目標都指向這一館 ── */
  {
    id: PAGE_IDS.galleryRelay,
    title: '[測試] 中繼塔影像集',
    pageType: 'gallery',
    sortOrder: 90,
    content: richText(''),
    metadata: {
      icon: 'tower-broadcast',
      description: '設施本身的紀錄照，與劇情插圖分開建檔。',
      group: '測試素材',
      spoilerLevel: 0,
      layout: 'pinboard',
      entityKey: ENTITY_KEYS.gallery,
      images: [
        {
          id: 'test-img-exterior',
          file: 'images/test-relay-exterior.png',
          caption: '塔的外觀',
          sortOrder: 0,
        },
        {
          id: 'test-img-interior',
          file: 'images/test-relay-interior.png',
          caption: '第四層',
          sortOrder: 1,
        },
      ],
    },
  },
  {
    id: PAGE_IDS.galleryWarden,
    title: '[測試] 守望者影像',
    pageType: 'gallery',
    sortOrder: 91,
    content: richText(''),
    metadata: {
      icon: 'user',
      description: '人事檔案裡的三張照片，第三張沒有日期。',
      group: '測試素材',
      spoilerLevel: 0,
      layout: 'pinboard',
      entityKey: ENTITY_KEYS.warden,
      images: [
        {
          id: 'test-img-warden',
          file: 'images/test-warden.png',
          caption: '值班中的凱蘭',
          sortOrder: 0,
        },
        {
          id: 'test-img-warden-2',
          file: 'images/test-warden-2.png',
          caption: '入職照',
          sortOrder: 1,
        },
        {
          id: 'test-img-warden-3',
          file: 'images/test-warden-3.png',
          caption: '沒有日期的那張',
          sortOrder: 2,
        },
      ],
    },
  },
];

/* ── Storage ───────────────────────────────────────────────── */

export const STORAGE_PAGES = [
  {
    id: PAGE_IDS.stuffOpen,
    title: '[測試] 檔案箱・已開封',
    pageType: 'stuff',
    sortOrder: 90,
    content: richText(
      filler([
        '一疊照片、一卷磁帶、一支停在四十一秒的碼表。',
        '封存標籤上的日期比事件晚了五年，經手人簽名的欄位是空的。',
      ])
    ),
    metadata: { icon: 'box-open', description: '測試素材：一般可讀的收藏品。' },
  },
  {
    id: PAGE_IDS.stuffLocked,
    title: '[測試] 檔案箱・封條未拆',
    pageType: 'stuff',
    sortOrder: 91,
    content: richText(
      filler([
        '箱子比其他的重，搖起來沒有聲音。',
        '封條上寫著「建議不要派人」，字跡和值班紀錄最後一頁相同。',
      ])
    ),
    // 自訂旗標條件 → flag 鎖 → 整張從列表消失（不是模糊、不是封箱）。
    // ⚠️ 這張在 Storage 接上進度求值前是**完全公開**的：那時 StorageReader
    // 的 isLocked 不帶 progress，只判靜態 locked，gate 沒有任何消費端。
    metadata: {
      icon: 'box-archive',
      description: '測試素材：被自訂旗標 gate 的收藏品（flag 鎖）。',
      gate: { requiresFlags: [FLAGS[0].name] },
    },
  },
  {
    id: PAGE_IDS.stuffProgression,
    title: '[測試] 檔案箱・待讀完',
    pageType: 'stuff',
    sortOrder: 92,
    content: richText(
      filler([
        '箱底壓著一份未署名的談話稿，開頭第一句就假設讀者已經到過中繼塔。',
        '沒到過的人讀了也不會懂——所以它被收在這裡等。',
      ])
    ),
    // 純 completed:* 條件 → progression 鎖。Storage 與 History 不同，
    // 這一類同樣整張藏起來（艾斯維爾 2026-08-10）：對話標題本身會劇透，
    // 而這一區沒有「下一篇在前方」的敘事引導需求。
    metadata: {
      icon: 'box-archive',
      description: '測試素材：需先讀完長文的收藏品（progression 鎖）。',
      gate: { requiresFlags: [`completed:${PAGE_IDS.long}`] },
    },
  },
  {
    id: PAGE_IDS.stuffPristine,
    title: '[測試] 檔案箱・純潔者限定',
    pageType: 'stuff',
    sortOrder: 93,
    content: richText(
      filler([
        '一段沒有前情提要的閒聊，聽得懂的人此刻還不知道後面會發生什麼。',
        '知道了的人再回來看，就只剩諷刺。',
      ])
    ),
    metadata: {
      icon: 'box-archive',
      description: '測試素材：純潔者限定的收藏品。',
      gate: { pristineOnly: true },
    },
  },
];

/* ── Concepts ──────────────────────────────────────────────
 *
 * 四種 stack_style 各建一個**新的** type 頁，不覆蓋既有的十五個空殼——
 * 那些 id 在正式環境有真內容，借用會讓 test 與 prod 的同一個 id 指向
 * 完全不同的東西，日後對帳時極容易誤判。
 *
 * ⚠️ browser 的 profile 必須有對應的 dossier 條目：entity 可不可點取決於
 * 「相應浮島查得到內容」，而 entity 的權威顯示名稱來自 dossier 條目的 name。
 * 只有 browser profile 而沒有 dossier 條目的 entityKey 會變成有 profile 卻
 * 查不到名字的半吊子狀態。
 */

const block = (id, type, data) => ({
  id,
  type,
  content: typeof data === 'string' ? data : JSON.stringify(data),
});

export const CONCEPTS_PAGES = [
  {
    id: PAGE_IDS.conceptsDossier,
    title: '[測試] 實體名錄',
    pageType: 'type',
    sortOrder: 90,
    content: [
      block(
        'intro',
        'rich_text',
        '<p>測試素材：dossier 條目，entity 的權威名稱來源。</p>'
      ),
      block('content', 'dossier', {
        variants: [
          {
            id: 'default',
            label: 'DEFAULT',
            subcategories: [
              {
                label: '第七中繼塔',
                groups: [
                  {
                    label: '人物',
                    entries: [
                      {
                        name: '凱蘭·佛斯特',
                        entityKey: ENTITY_KEYS.warden,
                        aliases: ['凱蘭', 'Kellan Forster'],
                        content_html:
                          '<p>第七中繼塔第四層的值班員，在職十一年。最後一次出入紀錄之後沒有離開的紀錄。</p>',
                        spoiler: 0,
                      },
                      {
                        name: '蜜拉·凡登',
                        content_html:
                          '<p>補給車司機，跑這條線七年。沒有掛 entityKey——用來對照「沒有深連需求的條目」。</p>',
                        spoiler: 0,
                      },
                    ],
                  },
                  {
                    label: '地點',
                    entries: [
                      {
                        name: '第七中繼塔',
                        entityKey: ENTITY_KEYS.tower,
                        aliases: ['中繼塔', '第七塔'],
                        content_html:
                          '<p>圓筒外牆，內部七層，每層一道朝北的窗。位置與高度都不符合中繼需求。</p>',
                        spoiler: 0,
                      },
                    ],
                  },
                  {
                    label: '受限條目',
                    // 群組 gate：未通過前整組隱藏，底下條目的 gate 不再求值
                    gate: { requiresFlags: [FLAGS[1].name] },
                    entries: [
                      {
                        /* ⚠️ 掛 entityKey 是刻意的：長文附錄的 entity span
                           指向這條，探索者未持旗前「浮島查不到內容」→
                           普通文字，拿旗後即時變可點——gate entity 的
                           唯一驗收路徑（Ariel 2026-08-12 回饋補洞）。 */
                        name: '荒地下方的結構',
                        entityKey: ENTITY_KEYS.substructure,
                        aliases: ['地下結構'],
                        content_html:
                          '<p>鑽探紀錄上被劃掉的那一行備註。整組被 gate 擋住時這條也看不見。</p>',
                        spoiler: 1,
                      },
                    ],
                  },
                  {
                    label: '未歸類',
                    entries: [
                      {
                        /* 條目層 gate（pristineOnly）：純潔探索者可點，
                           一旦當過觀測者（observerEver）永久退回普通文字
                           ——S1「切回不殘留可點樣式」的判定素材。 */
                        name: '荒地上的形狀',
                        entityKey: ENTITY_KEYS.figure,
                        aliases: ['形狀'],
                        gate: { pristineOnly: true },
                        content_html:
                          '<p>只有從未見證過一切的人查得到這一條。照片邊緣站著的形狀，面朝塔，距離不可能是人。</p>',
                        spoiler: 1,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ],
    metadata: {
      icon: 'address-book',
      description: '測試素材：dossier stack。',
      type_group: 'test_entities',
      era: 'u',
      stack_style: 'dossier',
    },
  },
  {
    id: PAGE_IDS.conceptsBrowser,
    title: '[測試] 人物檔案',
    pageType: 'type',
    sortOrder: 90,
    content: [
      block(
        'intro',
        'rich_text',
        '<p>測試素材：browser profile，對應 dossier 的同一個 entityKey。</p>'
      ),
      block('content', 'browser_profile', {
        hints: [],
        category_tree: [
          { label: '測試素材', children: [{ label: '第七中繼塔' }] },
        ],
        profiles: [
          {
            // ⚠️ 與 dossier 的「凱蘭·佛斯特」同一個 entityKey——這是刻意的：
            // browser 至少要有一個 entity 在 dossier 裡查得到對應條目
            name: '凱蘭·佛斯特 (Kellan Forster)',
            entityKey: ENTITY_KEYS.warden,
            categories: ['測試素材', '第七中繼塔'],
            basic: {
              出處: '第七中繼塔',
              職務: '中繼站值班員',
              在職年數: '11',
              當前狀態: '下落不明',
              最後紀錄: '第十一次靜默當日',
            },
            sections: [
              {
                label: '角色背景',
                content_html:
                  '<p>來到塔裡的時候還有六個人。人一個一個被調走，理由都很正當。</p>',
              },
              {
                label: '角色解析',
                content_html:
                  '<p>值班紀錄的字跡在最後三個月明顯變化。前段工整，後段潦草到需要辨認。</p>',
              },
            ],
            spoiler: 0,
          },
          {
            name: '蜜拉·凡登 (Mira Vanden)',
            categories: ['測試素材', '第七中繼塔'],
            basic: { 出處: '補給路線', 職務: '補給車司機', 年資: '7' },
            sections: [
              {
                label: '角色背景',
                content_html:
                  '<p>沒有掛 entityKey 的 profile——用來對照「不參與深連的檔案」。</p>',
              },
            ],
            spoiler: 0,
          },
        ],
      }),
    ],
    metadata: {
      icon: 'person-rays',
      description: '測試素材：browser stack。',
      type_group: 'test_profiles',
      era: 'u',
      stack_style: 'browser',
    },
  },
  {
    id: PAGE_IDS.conceptsChrono,
    title: '[測試] 事件時序',
    pageType: 'type',
    sortOrder: 90,
    content: [
      block(
        'intro',
        'rich_text',
        '<p>測試素材：chronograph，時期不帶 entityKey。</p>'
      ),
      block('content', 'chronograph', {
        fieldDefs: [
          {
            id: 'main',
            icon: 'circle-dot',
            label: '主線事件',
            style: 'flat',
          },
          {
            id: 'regional',
            icon: 'map',
            label: '區域動態',
            style: 'grouped',
          },
        ],
        periods: [
          {
            era: 'ad',
            yearNum: 1,
            year: 'AD 0001',
            title: '第一次靜默',
            fields: {
              main: { items: ['訊號延遲被記為「輕微延遲」', '全塔靜默十二秒'] },
              regional: {
                groups: [
                  { label: '荒地', items: ['風速紀錄中斷十二秒'] },
                  { label: '輸電線', items: ['無異常'] },
                ],
              },
            },
          },
          {
            era: 'ad',
            yearNum: 2,
            year: 'AD 0002',
            title: '拍照期',
            fields: {
              main: { items: ['第六張照片拍到形狀', '膠卷送洗，來回三週'] },
              regional: {
                groups: [{ label: '荒地', items: ['光線失去方向性'] }],
              },
            },
          },
          {
            era: 'ad',
            yearNum: 3,
            year: 'AD 0003',
            title: '第十一次',
            // 時期可隨進度揭露——驗 gate 在 chrono 也生效
            gate: { requiresFlags: [FLAGS[0].name] },
            fields: {
              main: { items: ['腳步聲沒有在第五層停下', '值班紀錄只剩一行字'] },
              regional: { groups: [{ label: '荒地', items: ['—'] }] },
            },
          },
        ],
      }),
    ],
    metadata: {
      icon: 'calendar-exclamation',
      description: '測試素材：chrono stack。',
      type_group: 'test_timeline',
      era: 'u',
      stack_style: 'chrono',
    },
  },
  {
    id: PAGE_IDS.conceptsDiff,
    title: '[測試] 名詞對照',
    pageType: 'type',
    sortOrder: 90,
    content: [
      block(
        'intro',
        'rich_text',
        '<p>測試素材：diff table，一個詞對多個值。</p>'
      ),
      block('content', 'diff_table', {
        subcategories: [
          {
            label: '設施',
            sections: [
              {
                label: '中繼系統',
                valueLabels: ['英文', '代號'],
                entries: [
                  {
                    term: '第七中繼塔',
                    values: ['Relay Tower VII', 'RT-07'],
                    spoiler: 0,
                  },
                  {
                    term: '靜默',
                    values: ['Blackout', 'BO'],
                    spoiler: 0,
                  },
                  {
                    term: '尚未解釋的概念',
                    values: ['—', '—'],
                    // 已出現但尚未解釋
                    locked: true,
                  },
                  {
                    term: '尚未出現的概念',
                    values: ['—', '—'],
                    // 故事中還沒出現
                    hidden: true,
                  },
                ],
              },
            ],
          },
          {
            label: '現象',
            sections: [
              {
                label: '未被歸類',
                valueLabels: ['英文'],
                entries: [
                  { term: '無方向光', values: ['Directionless Light'] },
                  {
                    term: '第十五座',
                    values: ['The Fifteenth'],
                    gate: { requiresFlags: [FLAGS[1].name] },
                  },
                ],
              },
            ],
          },
        ],
      }),
    ],
    metadata: {
      icon: 'language',
      description: '測試素材：diff stack。',
      type_group: 'test_glossary',
      era: 'u',
      stack_style: 'diff',
    },
  },
];

/**
 * 早期版本寫錯位置、現已搬走的頁面 id。
 *
 * 素材第一版把劇情歌塞進 `echoes/areas`、劇情插圖塞進 `visuals/profiles`，
 * 但兩邊的分類都是**由所在 cluster／division 推導**的：劇情歌一定在
 * `echoes/stories`、劇情插圖一定在鑲框室 `visuals/illustrations`，編輯器
 * 本身就依這個規則篩選與顯隱欄位。搬家之後舊 id 仍留在 D1，會在導覽樹裡
 * 變成掛著測試標題卻永遠觸發不了的死頁。
 *
 * 保留這份清單而不是「刪掉就算了」：任何人重跑腳本都會一併清乾淨，
 * 不必知道曾經有過那一版。
 */
export const STALE_PAGE_IDS = [
  'echoes/areas/ad_main/test-hymn-of-silence',
  'echoes/areas/ad_main/test-relay-signal',
  'visuals/profiles/characters/test-relay-gallery',
];

/** 所有要寫入的頁面（依區域分組，寫入順序＝依賴順序） */
export const ALL_PAGES = [
  // Concepts 先寫：History 的 entity 要能查到條目才不會退回普通文字
  ...CONCEPTS_PAGES,
  ...ECHOES_PAGES,
  ...VISUALS_PAGES,
  ...STORAGE_PAGES,
  ...HISTORY_PAGES,
];
