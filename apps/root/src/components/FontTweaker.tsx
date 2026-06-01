/**
 * FontTweaker — 開發/Staging 環境字體切換器
 * 右上角按鈕，cycle 切換整站 body 字體
 */
import { useState, useCallback, useEffect, useRef } from 'react';

import './FontTweaker.css';
import { envConfig } from '../config/env';

interface FontPreset {
  name: string;
  /** 標籤：英文字體 + 中文字體 */
  label: string;
  fontStack: string;
  /** 支援多個 CSS URL（Google Fonts + jsDelivr 等） */
  fontUrls?: string[];
}

const PRESETS: FontPreset[] = [
  // ① 現代幾何 + 黑體（目前預設）
  {
    name: 'default',
    label: 'Jakarta + 黑體',
    fontStack:
      "'Plus Jakarta Sans', 'Noto Sans TC', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  // ② 高對比襯線 + 宋體（雜誌編輯風）
  {
    name: 'serif-editorial',
    label: 'Playfair + 宋體',
    fontStack: "'Playfair Display', 'Noto Serif TC', Georgia, serif",
    fontUrls: [
      'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Noto+Serif+TC:wght@400;500;700&display=swap',
    ],
  },
  // ③ 圓潤 + 圓體（溫暖親切）
  {
    name: 'round-friendly',
    label: 'Quicksand + 粉圓',
    fontStack: "'Quicksand', 'Huninn', sans-serif",
    fontUrls: [
      'https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700&family=Huninn&display=swap',
    ],
  },
  // ④ 書本襯線 + 楷體（文學典雅）
  {
    name: 'literary-kaiti',
    label: 'Lora + 文楷',
    fontStack: "'Lora', 'LXGW WenKai TC', Georgia, serif",
    fontUrls: [
      'https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400&family=LXGW+WenKai+TC:wght@300;400;700&display=swap',
    ],
  },
  // ⑤ 古典襯線 + 古典明體（傳承字形）
  {
    name: 'classical',
    label: 'Cormorant + 古典明',
    fontStack: "'Cormorant Garamond', 'Cactus Classical Serif', Georgia, serif",
    fontUrls: [
      'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Cactus+Classical+Serif&display=swap',
    ],
  },
  // ⑥ 精緻無襯線 + 傳承黑體（現代英文 × 傳統字形黑體）
  {
    name: 'heritage-gothic',
    label: 'Inter + 傳承黑體',
    fontStack:
      "'Inter', 'Chocolate Classical Sans', 'Noto Sans TC', sans-serif",
    fontUrls: [
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Chocolate+Classical+Sans&display=swap',
    ],
  },
  // ⑦ 清晰教學 + 芫荽（教育部標準字形）
  {
    name: 'education',
    label: 'Source Sans + 芫荽',
    fontStack: "'Source Sans 3', 'Iansui', sans-serif",
    fontUrls: [
      'https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Iansui&display=swap',
    ],
  },
  // ⑧ 等寬 + 老明體（終端復古）
  {
    name: 'mono-retro',
    label: 'Mono + 老明體',
    fontStack: "'JetBrains Mono', 'Zen Old Mincho', ui-monospace, serif",
    fontUrls: [
      'https://fonts.googleapis.com/css2?family=Zen+Old+Mincho:wght@400;500;600;700;900&display=swap',
    ],
  },
];

const STORAGE_KEY = 'font-tweak-index';

export default function FontTweaker() {
  const [index, setIndex] = useState(0);
  const [showLabel, setShowLabel] = useState(false);
  const labelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedFonts = useRef<Set<string>>(new Set());

  // 只在開發/staging 環境顯示
  const canShow = envConfig.isDev || envConfig.isStaging;

  const loadFontCss = useCallback((url: string) => {
    if (loadedFonts.current.has(url)) return;
    loadedFonts.current.add(url);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    document.head.appendChild(link);
  }, []);

  const applyFont = useCallback(
    (i: number) => {
      const preset = PRESETS[i];
      preset.fontUrls?.forEach(loadFontCss);
      document.documentElement.style.setProperty(
        '--q-font-body',
        preset.fontStack
      );
    },
    [loadFontCss]
  );

  // 初始化：從 localStorage 恢復上次選擇
  useEffect(() => {
    if (!canShow) return;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      const i = parseInt(saved, 10);
      if (!isNaN(i) && i >= 0 && i < PRESETS.length) {
        setIndex(i);
        applyFont(i);
      }
    }
  }, [canShow, applyFont]);

  const cycle = useCallback(() => {
    const next = (index + 1) % PRESETS.length;

    // 微轉場：短暫降低 opacity
    document.documentElement.classList.add('font-tweak-switching');
    setTimeout(() => {
      setIndex(next);
      applyFont(next);
      localStorage.setItem(STORAGE_KEY, String(next));
      document.documentElement.classList.remove('font-tweak-switching');
    }, 120);

    // 顯示標籤
    setShowLabel(true);
    if (labelTimer.current) clearTimeout(labelTimer.current);
    labelTimer.current = setTimeout(() => setShowLabel(false), 2200);
  }, [index, applyFont]);

  // 清理 timer
  useEffect(() => {
    return () => {
      if (labelTimer.current) clearTimeout(labelTimer.current);
    };
  }, []);

  if (!canShow) return null;

  const preset = PRESETS[index];

  return (
    <div className="font-tweak">
      <button
        className="font-tweak__btn"
        onClick={cycle}
        title={`字體切換：${preset.label}（${index + 1}/${PRESETS.length}）`}
        aria-label="切換字體"
      >
        Aa
      </button>
      <div
        className={`font-tweak__label${showLabel ? ' font-tweak__label--visible' : ''}`}
      >
        <span className="font-tweak__label-index">
          {index + 1}/{PRESETS.length}
        </span>
        <span className="font-tweak__label-name">{preset.label}</span>
      </div>
    </div>
  );
}
