/**
 * Seed 腳本：將首頁硬編碼文字資料寫入 D1 的 site_homepage 表
 *
 * 使用方式：
 *   node scripts/seed-homepage.mjs           # 寫入本地 D1
 *   node scripts/seed-homepage.mjs --remote  # 寫入遠端 D1
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// === 設定 ===
const USE_REMOTE = process.argv.includes('--remote');

// wrangler.toml 在 workers/content-api，需切換到該目錄執行指令
const WORKER_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')),
  '..',
  'workers',
  'content-api'
);

console.log('\n🏠 首頁 Seed 工具');
console.log(`   目標: ${USE_REMOTE ? '遠端 D1' : '本地 D1'}`);
console.log(`   工作目錄: ${WORKER_DIR}\n`);

// === 工具：將旁白陣列 + UEP 台詞陣列合併為 TipTap HTML ===
function buildBody(narration, uepLines) {
  const parts = [];
  for (const p of narration) parts.push(`<p>${p}</p>`);
  for (let i = 0; i < uepLines.length; i++) {
    const side = i % 2 === 0 ? 'left' : 'right';
    parts.push(`<div data-role="uep" data-side="${side}">${uepLines[i]}</div>`);
  }
  return parts.join('\n');
}

// === 永恆之詩：關鍵字加上粗體+斜體+金色 ===
function buildVerseBody(lines) {
  const keywords = ['輪迴', '創世', '毀滅', '聚合', '反饋', '置換', '虛無'];
  const parts = [];
  for (const line of lines) {
    if (line === '—') {
      parts.push('<hr>');
      continue;
    }
    let html = line;
    for (const kw of keywords) {
      html = html.replace(
        new RegExp(kw, 'g'),
        `<em><strong style="color: var(--uep-gold)">${kw}</strong></em>`
      );
    }
    parts.push(`<p>${html}</p>`);
  }
  return parts.join('\n');
}

// === 首頁各 section 的資料 ===
const sections = [
  {
    section_id: 'hero',
    content: {
      kicker: 'U.E.P · Imaginary Space',
      titleMain: '世界的',
      titleAccent: '邊際',
      subtitleEn: 'edge · world · observed',
      body: [
        '<p>你掉到了一個空白的空間，<br>周圍甚麼都沒有 ——<br>一名有著金色頭髮的少女從虛無當中顯現。</p>',
        '<div data-role="uep" data-side="left">你好啊! ╰(*°▽°*)╯ 我的名字叫U.E.P，跟我來，我來跟你介紹一下這裡!</div>',
      ].join('\n'),
      buttons: {
        openMap: '✦ 開啟大地圖',
        startJourney: '↓ 開始遊歷',
        admin: '⚙ 後台管理',
      },
    },
  },
  {
    section_id: 'atlas',
    content: {
      kicker: 'the atlas',
      title: '邊際世界',
      hint: '地圖即導航 · 拖曳旋轉 · 上下傾斜 · 點擊區塊進入',
    },
  },
  {
    section_id: 'journey',
    content: {
      kicker: '— 邊際世界遊歷 —',
      title: '跟我來吧',
      body: buildBody(
        [
          '自稱U.E.P的少女將你的手拉住，一道極彩色的門扉從你們身後顯現。',
          '你們正處在一個華麗的廳堂，看上去是由大理石所建成的。仔細一看，那些似乎是虛構的純白物質，時不時有雜訊從中飛出。',
        ],
        [
          '沒有必要這麼拘謹喔! 這裡很少有人來拜訪，因此我還蠻開心的! φ(゜▽゜*)♪',
          '然後，叫我小U就可以了，這樣也比較方便吧!',
        ]
      ),
    },
  },
  {
    section_id: 'zone-history',
    content: {
      meta: {
        label: '歷史典藏庫',
        en: 'History',
        kicker: 'Volume I',
        blurb: '小說、文章、篇章紀錄。書頁在無重力中編成書。',
        atmos: '書庫、年代感、敘事',
        glyphs: ['史', '傳', '誌', '卷'],
        uepShort: [
          '很壯觀吧! 這些都是我在各個時空當中找到的故事，我很自豪喔!',
          '這些看起來像玻璃的東西叫做「回想碎片」，碰一下就會直接進到頭腦裡!',
          '那些咻咻咻飛來飛去的紙張，都在進行他們自己的「故事重導」喔!',
        ],
        stats: { 篇章: 8, 區間: 3, 子章節: 60 },
      },
      body: buildBody(
        [
          '眼前的景色讓你嘆為觀止。這裡儼然是一座大型圖書館，無數書頁正有條理地在天空中飛舞著。你不確定這是某種魔法還是甚麼超自然力量的影響。',
          '你試圖去靠近那些透明的碎片，但在將要接觸到的那一刻…… 啵 的一聲，空靈的聲音響起，周遭的碎片在一瞬間全部破碎。',
          '在毫無預兆之下，那女孩從你的後方再次出現，手上拿著一個奇異的手環。隨著她手指的操弄，原本錯綜複雜的書庫被分成了三個有著告示牌的區間。',
        ],
        [
          '很壯觀吧! 這些都是我在各個時空當中找到的故事，我很自豪喔! (๑•̀ㅂ•́)و✧',
          '周圍的這些看起來像玻璃的東西叫做「回想碎片」，只要碰一下某些人的故事就會直接進到頭腦裡!',
          '那些咻咻咻正在飛來飛去的紙張都在進行他們自己的「故事重導」，他們知道自己應該被放在那些位置，然後會自己編成一本書喔!',
          '帶著這個! 這樣如果你在這個空間中迷路了，可以隨時回到一開始的那個大廳!',
          '這樣! 我建議你可以先看看這些我已經整理好的部分! []~(￣▽￣)~*',
        ]
      ),
    },
  },
  {
    section_id: 'zone-echoes',
    content: {
      meta: {
        label: '回音蒐藏間',
        en: 'Echoes',
        kicker: 'Volume II',
        blurb: '音樂、OST、聲音作品。可被捧起的回憶之球。',
        atmos: '聲波、夜色、情緒',
        glyphs: ['音', '嗚', '迴', '響'],
        uepShort: [
          '歡迎來到充滿了世界之聲的蒐藏間，這裡聽到的全部都是實際存在的對話喔!',
          '這些球球叫做「回聲」，每一個都儲存著一段重要的回憶!',
          '藍 / 紅 / 綠 / 紫 — 每種顏色都對應到不同類型的故事，記得嗎?',
        ],
        stats: { 地點: 9, 角色組: 5, 劇情: 9, 特別: 3 },
      },
      body: buildBody(
        [
          '多種美好的聲音在空氣中交錯著，偶爾能夠聽見某些人正在低語著。一種難以被捕捉的球狀物體正規律的浮動，你不清楚那究竟是什麼。',
          '你試著用雙手將其中一個回聲給捧了起來。可見的音符與粒子從兩旁飛進了你的耳內，澎湃激昂的景色頓時湧入了腦海。那是一種多麼暢快的感受，一瞬間，你彷彿成為了那戰場上英勇奮戰的將軍。',
          '小U用手指輕輕碰了一下你的臉頰，回聲們就紛紛跑了出來。',
        ],
        [
          '歡迎來到充滿了世界之聲的蒐藏間，在這裡能夠聯到的全部都是實際存在的對話喔! (☆▽☆)',
          '這些球球很可愛吧! 他們叫做「回聲」，每一個都儲存著一段重要的回憶!',
          '藉由將畫面以旋律的方式保存起來，所有人都可以如同身歷其境一樣，用自己的視野體驗一段故事!',
          '他們並不是始終保持同樣的內容，而是會隨著時間進化自己，來更加完善的去詮釋他們所欲表達的故事!',
        ]
      ),
    },
  },
  {
    section_id: 'zone-visuals',
    content: {
      meta: {
        label: '幻影重現室',
        en: 'Visuals',
        kicker: 'Volume III',
        blurb: '畫作、插圖、視覺作品。半透明的人物像在水面盪漾。',
        atmos: '影像、夢幻、展示廳',
        glyphs: ['影', '像', '幻', '鏡'],
        uepShort: [
          '小心不要跟錯人了喔，小U.E.P可是獨一無二的!',
          '這裡是世界的印象，每一個人都曾經存在於某一個時間當中。',
          '他們是虛假幻象，但你是可以去接觸甚至仔細觀察他們的喔!',
        ],
        stats: { 畫廊: 4, 走廊: 3, 草圖: 3, AI: 2 },
      },
      body: buildBody(
        [
          '有時候你會分不出來究竟哪一道才是你的影子。許多你從未見過的人物正活生生的在你身旁走動、談話。但靠近一看，他們終究只是虛幻的投影。',
          '你不得不驚嘆那可怕的重現度，每一個幻影的視線都是如此的炯炯有神。說不定你也只是其中的一介幻影，而單純不知情罷了。',
          '小U上前拉了拉某位男人的衣服，那人隨即像是實體化了一般，獲得了自我意識。看上去想說些甚麼，卻沒辦法傳達聲音，感覺有一定程度的隔離。',
        ],
        [
          '小心不要跟錯人了喔，小U.E.P可是獨一無二的! (^///^)',
          '這裡是世界的印象，每一個人都曾經存在於某一個時間當中，你可能也在裡面喔～',
          '不用擔心! 這裡映照出來都不是真實的，而只是跟隨世界本身而成的虛假幻象!',
          '雖然說是投影，但你是可以去接觸甚至仔細觀察他們的喔!',
          '好啦! 接下來是我最喜歡待著的地方! 走囉! o((>ω< ))o',
        ]
      ),
    },
  },
  {
    section_id: 'zone-concepts',
    content: {
      meta: {
        label: '概念調整房',
        en: 'Concepts',
        kicker: 'Volume IV',
        blurb: '世界觀、設定文件。原質、概念、伺服器內部。',
        atmos: '研究、架構、知識',
        glyphs: ['定', '質', '規', '理'],
        uepShort: [
          '很科幻的房間對不對! 而且還很大 (回音: 大大大大大....)',
          '所有關於世界的概念全部都在這裡! 他們會自己去修復錯誤並逐漸變得完美!',
          '這些東西看起來像是文字，但實際上是「原質」(Essence) 喔!',
        ],
        stats: { 主機: 4, 紀錄: 12, 理論: 8, 對照: 3 },
      },
      body: buildBody(
        [
          '許多螢幕懸浮在空中，你能看到很多不同場景顯現在其中。漂浮的文字若無其事的與大氣並存，看上去儼然就是大型電腦伺服器。數台不清楚用途的裝置正在嗡嗡作響，毫無停息的工作著。',
          '你試著用手去捕捉那些懸浮的字母，在接觸到的那一刻他卻神奇地跟你的皮膚融合了! 如同刻印上去了一般，卻又在短暫的時間之後消失。',
          '小U彈了彈手指，一套良好的茶會用桌椅就這麼出現在一旁，上頭還有熱騰騰的茶杯被擺飾好了。你嘗了一口茶，甜甜的且溫度適中，而且意外的是你喜歡的口味。',
        ],
        [
          '很科幻的房間對不對! 而且還很大 (回音: 大大大大大....) 👈(ﾟヮﾟ👈)',
          '所有關於世界的概念全部都在這裡! 他們會自己去修復錯誤並逐漸變得完美!',
          '這些東西看起來像是文字，但實際上是「原質」(Essence) 喔!',
          '原質是所有事物的最小構成單位，概念上的，不是實質上的。聽起來很複雜對吧? 先別想這麼多，喝杯茶吧!',
          '「概念」就是所有事物存在的本質喔，只要它存在，那麼就是被定義為真實的!',
          '主要的區域都介紹完了，我來帶你去一些比較小的地方吧!',
        ]
      ),
    },
  },
  {
    section_id: 'zone-storage',
    content: {
      meta: {
        label: '某人的置物空間',
        en: 'Storage',
        kicker: 'Volume V',
        blurb: '公告、Meta、雜項。一片散亂卻自有秩序的房間。',
        atmos: '個人筆記、後台、Meta',
        glyphs: ['記', '雜', '稿', 'Σ'],
        uepShort: [
          '這裡...這裡是哪裡啊? 我不記得這裡有這種房間啊?',
          '這個空間像是某個人的倉庫? 不知道是不是被其他力量所干涉而產生的。',
          '如果你對於這裡有些興趣的話，之後應該可以帶你回來的!',
        ],
        stats: { 對話: 1, 紀錄: 4, 外界: 2 },
      },
      body: buildBody(
        [
          '你從一片虛無當中掉到了一大堆枕頭所組成的小山丘當中。茶具已經無影無蹤了，而少女正神態自若的坐在半空中看著你被羽絨緊緊包覆著。',
          '幾經波折之後，你總算是找到了一條出來的路，這裡是一間還挺平凡的房間。你趁著這段時間四處觀望，這整個空間就跟一般常見的工作室沒兩樣，只是似乎沒有可見的盡頭。',
          '拿起幾張散落的紙張，上面只能看到零散的文字，似乎是一些紀錄靈感用的文件。',
        ],
        [
          '這裡...這裡是哪裡啊? 我不記得這裡有這種房間啊? 看起來還有人住的樣子，稍等我一下喔!',
          '你發現了什麼嗎? 我在附近沒有發現其他人呢 (´･ω･`)?',
          '總之這個空間像是某個人的倉庫? 不知道是不是被其他力量所干涉而產生的。',
          '如果你對於這裡有些興趣的話，之後應該還是可以帶你回來的! 因為我自己也對裡面的某些東西感興趣啦，嘿嘿～ (*/ω＼*)',
        ]
      ),
    },
  },
  {
    section_id: 'verse',
    content: {
      kicker: '· The Eternal Verse ·',
      title: '永恆的意義',
      inscription: '—— inscribed on the wall ——',
      body: buildVerseBody([
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
      ]),
    },
  },
];

/**
 * 將 JSON 字串中的單引號轉義為 ''（SQLite 規則），
 * 同時處理反斜線，避免 SQL 注入問題。
 */
function escapeSql(jsonStr) {
  // 在 SQLite 中，單引號要用 '' 來跳脫
  return jsonStr.replace(/'/g, "''");
}

/**
 * 執行 wrangler d1 execute 指令
 * 使用 --file 避免 --command 在 Windows 上遇到特殊字元（空格、中文、em dash）時被 shell 切割。
 * @param {string} sql - 要執行的 SQL 語句
 * @param {boolean} remote - 是否使用遠端 D1
 */
function runWrangler(sql, remote) {
  const tmpFile = path.join(WORKER_DIR, '_seed_tmp.sql');
  fs.writeFileSync(tmpFile, sql, 'utf-8');
  try {
    const remoteFlag = remote ? ' --remote' : ' --local';
    const cmd = `npx wrangler d1 execute eternity-content${remoteFlag} --file=_seed_tmp.sql --yes`;
    execSync(cmd, {
      cwd: WORKER_DIR,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

// === 主程式 ===
async function main() {
  let successCount = 0;
  let errorCount = 0;

  for (const section of sections) {
    const { section_id, content } = section;

    // 將內容序列化為 JSON，再做 SQL 單引號轉義
    const jsonStr = JSON.stringify(content);
    const escapedJson = escapeSql(jsonStr);

    // 組合 INSERT OR REPLACE 語句
    const sql =
      `INSERT OR REPLACE INTO site_homepage (section_id, content, updated_at) ` +
      `VALUES ('${section_id}', '${escapedJson}', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`;

    try {
      runWrangler(sql, USE_REMOTE);
      console.log(`  ✓ ${section_id}`);
      successCount++;
    } catch (err) {
      console.error(`  ✗ ${section_id} — 錯誤: ${err.message}`);
      errorCount++;
    }
  }

  console.log(`\n完成！成功 ${successCount} 筆，失敗 ${errorCount} 筆。`);

  if (errorCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('執行失敗:', err);
  process.exit(1);
});
