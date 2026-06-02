/**
 * 將 TipTap 編輯器存的硬編碼顏色值替換為 CSS variable。
 *
 * Admin TipTap 的色板存的是 rgb() / hex 值（如 `rgb(39, 57, 108)`），
 * 在暗色模式下這些深色會看不清。替換為 CSS variable 後，
 * 暗色模式的 .dark 選擇器會自動套用正確的淺色。
 *
 * 在 SSR 端呼叫，避免客戶端閃爍。
 */

const COLOR_MAP: [RegExp, string][] = [
  // --q-navy（亮色 #27396c）
  [/(?<![\w-])color:\s*rgb\(\s*39,\s*57,\s*108\s*\)/gi, 'color: var(--q-navy)'],
  [/(?<![\w-])color:\s*#27396c/gi, 'color: var(--q-navy)'],
  // --q-navy-deep（亮色 #1a2240）
  [
    /(?<![\w-])color:\s*rgb\(\s*26,\s*34,\s*64\s*\)/gi,
    'color: var(--q-navy-deep)',
  ],
  [/(?<![\w-])color:\s*#1a2240/gi, 'color: var(--q-navy-deep)'],
  // --q-coral（亮色 #d6442e）
  [
    /(?<![\w-])color:\s*rgb\(\s*214,\s*68,\s*46\s*\)/gi,
    'color: var(--q-coral)',
  ],
  [/(?<![\w-])color:\s*#d6442e/gi, 'color: var(--q-coral)'],
  // --q-ink-soft（亮色 #3b4360）
  [
    /(?<![\w-])color:\s*rgb\(\s*59,\s*67,\s*96\s*\)/gi,
    'color: var(--q-ink-soft)',
  ],
  [/(?<![\w-])color:\s*#3b4360/gi, 'color: var(--q-ink-soft)'],
  // --q-ink（亮色 #0f1530）
  [/(?<![\w-])color:\s*rgb\(\s*15,\s*21,\s*48\s*\)/gi, 'color: var(--q-ink)'],
  [/(?<![\w-])color:\s*#0f1530/gi, 'color: var(--q-ink)'],
];

/** 將 HTML 字串中的硬編碼顏色替換為 CSS variable */
export function normalizeColors(html: string): string {
  if (!html) return html;
  let result = html;
  for (const [pattern, replacement] of COLOR_MAP) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
