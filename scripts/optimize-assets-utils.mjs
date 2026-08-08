/**
 * 資產瘦身腳本的純函式：路徑正規化、引用收集、轉檔規劃、內容改寫。
 *
 * 與 sync-utils.mjs 同樣的分工——會連 API 的流程留在腳本本體，
 * 無副作用但寫錯就會毀損 D1 的邏輯放這裡，讓它們可以被測試。
 */

import path from 'node:path';

/**
 * 各種寫法（裸 key、/images/…、/api/root/assets/…）統一成裸 R2 key。
 *
 * ⚠️ 外部圖床的絕對 URL 回空字串，**不可**只是把 origin 剝掉當成 key：
 * 內容裡確實有 `https://i.ibb.co/4t3ZsgP/xxx.png` 這種引用，剝掉 origin 後
 * 看起來就跟一個 R2 key 沒兩樣。萬一那條路徑撞上真實的 key，就會拿外部圖片
 * 的名義去改寫、甚至刪掉自家資產。只有明確指向本站資產端點的絕對 URL 才算數。
 */
export function normalizeKey(src) {
  let s = String(src ?? '').trim();

  if (/^https?:\/\//i.test(s)) {
    let parsed;
    try {
      parsed = new URL(s);
    } catch {
      return '';
    }
    if (!parsed.pathname.startsWith('/api/root/assets/')) return '';
    s = parsed.pathname;
  }

  s = s.replace(/^\/api\/root\/assets\//, '');
  s = s.replace(/^\//, '');
  try {
    s = decodeURIComponent(s);
  } catch {
    // 已經是未編碼的中文路徑，維持原樣
  }
  return s;
}

/** 裸 R2 key → 資產路徑（每段各自 encode，與 apps/root 的 assetUrl 一致） */
export function assetPath(key) {
  return `/api/root/assets/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * 從一筆 project 收集它引用的所有 R2 key。
 *
 * content 裡的 img src 是 URL 形式（段落經過 encode），image 欄位是裸 key，
 * 兩者都要正規化成裸 key 才能跟 R2 對得起來。
 */
export function collectKeys(project) {
  const keys = new Map(); // key → 出現在哪些欄位

  const addKey = (key, field) => {
    if (!key) return;
    if (!keys.has(key)) keys.set(key, new Set());
    keys.get(key).add(field);
  };

  if (project.image) addKey(normalizeKey(project.image), 'image');

  for (const field of ['contentZh', 'contentEn']) {
    const html = project[field];
    if (!html) continue;
    for (const m of html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)) {
      addKey(normalizeKey(m[1]), field);
    }
  }
  return keys;
}

/**
 * 決定一個資產要怎麼轉；不值得動的回 null。
 *
 * @param {string} key R2 key
 * @param {number} sizeBytes 目前大小
 * @param {number} minSizeKb 低於這個大小就不處理
 */
export function planFor(key, sizeBytes, minSizeKb) {
  const ext = path.extname(key).toLowerCase();
  if (sizeBytes < minSizeKb * 1024) return null;

  if (ext === '.gif') {
    return {
      kind: 'gif→mp4',
      newKey: key.replace(/\.gif$/i, '.mp4'),
      contentType: 'video/mp4',
      // 寬上限 1200：內容欄實際顯示不到 800px，1200 已涵蓋 retina
      // pad 補到偶數尺寸，H.264 的 yuv420p 不接受奇數
      ffmpegArgs: (input, output) => [
        '-y',
        '-v',
        'error',
        '-i',
        input,
        '-vf',
        "scale='min(1200,iw)':-2:flags=lanczos,pad=ceil(iw/2)*2:ceil(ih/2)*2",
        '-c:v',
        'libx264',
        '-crf',
        '26',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-an',
        output,
      ],
    };
  }

  if (['.png', '.jpg', '.jpeg'].includes(ext)) {
    return {
      kind: `${ext.slice(1)}→webp`,
      newKey: key.replace(/\.(png|jpe?g)$/i, '.webp'),
      contentType: 'image/webp',
      ffmpegArgs: (input, output) => [
        '-y',
        '-v',
        'error',
        '-i',
        input,
        '-vf',
        "scale='min(1600,iw)':-2:flags=lanczos",
        '-c:v',
        'libwebp',
        '-lossless',
        '0',
        '-q:v',
        '82',
        output,
      ],
    };
  }

  return null;
}

/**
 * 把 HTML 中指向 oldKey 的 <img> 換成新資產。
 *
 * 轉成影片時整個標籤要換成 <video>：<img src="*.mp4"> 在瀏覽器只會是破圖。
 * 屬性沿用 GIF 的行為（自動播放、循環、靜音），playsinline 是 iOS 不強制全螢幕的必要條件。
 *
 * @returns {{ html: string, changed: number }}
 */
export function rewriteHtml(html, oldKey, newKey, toVideo) {
  if (!html) return { html, changed: 0 };

  const newSrc = assetPath(newKey);
  let changed = 0;

  const out = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = tag.match(/\bsrc="([^"]+)"/i)?.[1];
    if (!src || normalizeKey(src) !== oldKey) return tag;
    changed++;
    if (!toVideo) return tag.replace(/\bsrc="[^"]+"/i, `src="${newSrc}"`);
    return `<video src="${newSrc}" autoplay loop muted playsinline></video>`;
  });

  return { html: out, changed };
}
