/**
 * Markdown 內容轉換工具
 * 將 GitBook 語法轉換為 Astro 元件語法
 */

/**
 * 轉換 {% hint %} 標籤
 */
export function transformHints(content: string): string {
  // 匹配 {% hint style="..." %} ... {% endhint %}
  const hintRegex = /{% hint style="([^"]+)" %}([\s\S]*?){% endhint %}/g;
  
  return content.replace(hintRegex, (_match, style, innerContent) => {
    const trimmedContent = innerContent.trim();
    return `<Hint type="${style}">\n${trimmedContent}\n</Hint>`;
  });
}

/**
 * 轉換 <mark> 標籤
 */
export function transformMarks(content: string): string {
  // 匹配 <mark style="color:xxx">...</mark>
  const markRegex = /<mark style="color:([^"]+)">([^<]+)<\/mark>/g;
  
  return content.replace(markRegex, (_match, color, text) => {
    return `<Mark color="${color}">${text}</Mark>`;
  });
}

/**
 * 轉換 {% tabs %} 標籤
 */
export function transformTabs(content: string): string {
  // 這個比較複雜，需要解析整個 tabs 結構
  const tabsRegex = /{% tabs %}([\s\S]*?){% endtabs %}/g;
  
  return content.replace(tabsRegex, (match, tabsContent) => {
    // 提取所有 tab
    const tabRegex = /{% tab title="([^"]+)" %}([\s\S]*?)(?={% tab|{% endtabs)/g;
    const tabs: Array<{title: string; content: string}> = [];
    
    let tabMatch;
    while ((tabMatch = tabRegex.exec(tabsContent)) !== null) {
      tabs.push({
        title: tabMatch[1],
        content: tabMatch[2].trim()
      });
    }
    
    if (tabs.length === 0) return match;
    
    // 生成 Tabs 元件的 props
    const tabsData = JSON.stringify(tabs.map((tab, idx) => ({
      id: `tab-${idx}`,
      title: tab.title,
      content: tab.content
    })));
    
    return `<Tabs tabs={${tabsData}} />`;
  });
}

/**
 * 轉換 ❇︎ 分隔線
 */
export function transformDividers(content: string): string {
  // 匹配一整行的 ❇︎ 符號
  const dividerRegex = /^❇︎{10,}$/gm;
  
  return content.replace(dividerRegex, '<Divider style="star" />');
}

/**
 * 轉換 <br> 標籤為雙空格換行
 */
export function transformLineBreaks(content: string): string {
  // 將 <br> 轉換為 Markdown 的雙空格換行
  return content.replace(/<br\s*\/?>/g, '  \n');
}

/**
 * 轉換 {% file %} 標籤為 AudioPlayer 元件
 */
export function transformFiles(content: string): string {
  const fileRegex = /{% file src="([^"]+)" %}/g;
  
  return content.replace(fileRegex, (_match, src) => {
    // 提取檔案名稱作為標題
    const filename = src.split('/').pop()?.replace(/\.[^/.]+$/, '') || 'Unknown';
    
    // 將 .gitbook/assets/ 路徑轉換為 /uep/assets/
    const publicPath = src.replace('../.gitbook/assets/', '/uep/assets/');
    
    // 返回 AudioPlayer 元件（預設使用 card 風格）
    return `<AudioPlayer src="${publicPath}" title="${filename}" variant="card" />`;
  });
}

/**
 * 處理 ◼︎ 隱藏內容符號
 */
export function transformHiddenContent(content: string): string {
  // 將連續的 ◼︎ 符號轉換為 Spoiler 組件
  const hiddenRegex = /◼︎{2,}/g;
  
  return content.replace(hiddenRegex, (match) => {
    return `<Spoiler variant="censored">${match}</Spoiler>`;
  });
}

/**
 * 綜合轉換函數
 */
export function transformGitBookContent(content: string): string {
  let transformed = content;
  
  // 依序應用轉換
  transformed = transformHints(transformed);
  transformed = transformMarks(transformed);
  transformed = transformTabs(transformed);
  transformed = transformDividers(transformed);
  transformed = transformLineBreaks(transformed);
  transformed = transformFiles(transformed);
  transformed = transformHiddenContent(transformed);
  
  return transformed;
}

/**
 * 從 frontmatter 提取並處理 icon
 */
export function processIcon(icon?: string): string {
  if (!icon) return '📄';
  
  // 如果是 emoji，直接返回
  if (/[\u{1F300}-\u{1F9FF}]/u.test(icon)) {
    return icon;
  }
  
  // 映射 GitBook icon 名稱到 emoji
  const iconMap: Record<string, string> = {
    'sparkle': '✨',
    'memo': '📝',
    'greater-than': '▶️',
    'caret-right': '▶️',
    'book': '📚',
    'folder': '📁',
    'file': '📄',
    'star': '⭐',
    'heart': '❤️',
    'info': '💡',
    'warning': '⚠️',
    'danger': '🚨',
  };
  
  return iconMap[icon] || '📄';
}
