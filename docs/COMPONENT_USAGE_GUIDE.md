# GitBook 語法轉換元件使用指南

本文檔說明如何使用新建立的 Astro 元件來替換 GitBook 語法。

## 已建立的元件

### 1. Hint 元件 (提示框)

**GitBook 語法:**
```markdown
{% hint style="info" %}
這裡列舉的內容可能並不完整，會有後續更新補正。
{% endhint %}
```

**Astro 元件語法:**
```astro
<Hint type="info">
這裡列舉的內容可能並不完整，會有後續更新補正。
</Hint>
```

**支援的類型:**
- `info` (藍色) - 一般資訊
- `warning` (黃色) - 警告訊息
- `danger` (紅色) - 危險警告
- `success` (綠色) - 成功訊息

---

### 2. Mark 元件 (標記文字)

**GitBook 語法:**
```html
<mark style="color:yellow">黃色標記文字</mark>
```

**Astro 元件語法:**
```astro
<Mark color="yellow">黃色標記文字</Mark>
```

**支援的顏色:**
- `yellow` - 黃色
- `red` - 紅色
- `blue` - 藍色
- `green` - 綠色
- `purple` - 紫色
- `orange` - 橙色
- `pink` - 粉色
- `cyan` - 青色

---

### 3. Tabs 元件 (分頁)

**GitBook 語法:**
```markdown
{% tabs %}
{% tab title="三區" %}
內容 A
{% endtab %}
{% tab title="四區" %}
內容 B
{% endtab %}
{% endtabs %}
```

**Astro 元件語法:**
```astro
---
const tabs = [
  { id: 'tab-1', title: '三區', content: '內容 A' },
  { id: 'tab-2', title: '四區', content: '內容 B' }
];
---

<Tabs tabs={tabs} />
```

---

### 4. Divider 元件 (分隔線)

**GitBook 語法:**
```
❇︎❇︎❇︎❇︎❇︎❇︎❇︎❇︎❇︎❇︎❇︎❇︎❇︎❇︎❇︎❇︎❇︎❇︎❇︎❇︎❇︎❇︎❇︎❇︎❇︎❇︎
```

**Astro 元件語法:**
```astro
<Divider style="star" />
```

**支援的樣式:**
- `star` - 星星圖案（保留原樣）
- `gradient` - 漸變線
- `simple` - 簡單線條
- `dots` - 點點動畫

**間距選項:**
```astro
<Divider style="gradient" spacing="large" />
```
- `small` - 小間距 (1.5rem)
- `normal` - 正常間距 (3rem)
- `large` - 大間距 (4.5rem)

---

## 在頁面中使用

### 在 .astro 檔案中:

```astro
---
import Hint from '../components/Hint.astro';
import Mark from '../components/Mark.astro';
import Divider from '../components/Divider.astro';
---

<div class="content">
  <Hint type="warning">
    這是一段警告訊息。
  </Hint>
  
  <p>這段文字包含<Mark color="yellow">重要標記</Mark></p>
  
  <Divider style="gradient" />
</div>
```

### 在 .mdx 檔案中:

```mdx
import { Hint, Mark, Divider } from '../components';

<Hint type="info">
這是資訊提示框。
</Hint>

這段文字包含<Mark color="red">紅色標記</Mark>的內容。

<Divider style="dots" spacing="small" />
```

---

## 自動轉換工具

已提供 `markdown-transforms.ts` 工具函數可自動轉換內容：

```typescript
import { transformGitBookContent } from '../utils/markdown-transforms';

const originalContent = `
{% hint style="info" %}
提示內容
{% endhint %}
`;

const transformed = transformGitBookContent(originalContent);
// 輸出: <Hint type="info">\n提示內容\n</Hint>
```

### 可用的轉換函數:

- `transformHints()` - 轉換 hint 標籤
- `transformMarks()` - 轉換 mark 標籤
- `transformTabs()` - 轉換 tabs 標籤
- `transformDividers()` - 轉換分隔線
- `transformLineBreaks()` - 轉換 `<br>` 為雙空格換行
- `transformFiles()` - 標記音訊檔案（待實作播放器）
- `transformHiddenContent()` - 處理 ◼︎ 隱藏內容
- `transformGitBookContent()` - 綜合轉換所有格式

---

## Icon 映射

frontmatter 中的 `icon` 欄位會自動轉換為 emoji：

```typescript
import { processIcon } from '../utils/markdown-transforms';

processIcon('sparkle');  // ✨
processIcon('memo');     // 📝
processIcon('star');     // ⭐
```

**支援的 icon 名稱:**
- `sparkle` → ✨
- `memo` → 📝
- `greater-than` / `caret-right` → ▶️
- `book` → 📚
- `folder` → 📁
- `file` → 📄
- `star` → ⭐
- `heart` → ❤️
- `info` → 💡
- `warning` → ⚠️
- `danger` → 🚨

---

### 5. AudioPlayer 元件 (音頻播放器)

**GitBook 語法:**
```markdown
{% file src="../.gitbook/assets/song.wav" %}
```

**Astro 元件語法:**
```astro
<AudioPlayer 
  src="/uep/assets/song.wav" 
  title="曲目名稱"
  description="賞析或描述文字"
  variant="card"
/>
```

**支援的變體 (variant):**
- `card` (預設) - 完整卡片式播放器，包含標題和描述
- `minimal` - 極簡版本，節省空間
- `inline` - 行內式，可嵌入文字段落中

**功能特色:**
- ✅ 播放/暫停控制
- ✅ 拖動進度條跳轉
- ✅ 音量調整與靜音
- ✅ 時間顯示（當前/總長）
- ✅ 互斥播放（同時只能播放一個）
- ✅ 響應式設計

**使用範例:**

```astro
<!-- Card 風格：適合概念曲展示 -->
<AudioPlayer
  src="/uep/assets/concept-song.wav"
  title="三區概念曲 - 「現代工業」"
  description="在這座被機械與蒸汽包圍的城市中，人們日復一日地勞作著..."
  variant="card"
/>

<!-- Minimal 風格：節省空間 -->
<AudioPlayer
  src="/uep/assets/bgm.wav"
  title="背景音樂"
  variant="minimal"
/>

<!-- Inline 風格：嵌入文字 -->
你發現了某些異常的聲音 <AudioPlayer 
  src="/uep/assets/distorted.wav" 
  title="扭曲的留言"
  variant="inline"
/> 她似乎在自言自語...
```

**自動轉換:**
`transformFiles()` 函數會自動將 `{% file %}` 標籤轉換為 AudioPlayer 元件。

---

### 5. AudioPlayer 元件 (音頻播放器)

**GitBook 語法:**
```markdown
{% file src="../.gitbook/assets/song.wav" %}
```

**Astro 元件語法:**
```astro
<AudioPlayer 
  src="/content/.gitbook/assets/song.wav" 
  title="曲目名稱"
  description="賞析或描述文字"
  variant="card"
/>
```

**支援的變體 (variant):**
- `card` (預設) - 完整卡片式播放器，包含標題和描述
- `minimal` - 極簡版本，節省空間
- `inline` - 行內式，可嵌入文字段落中

**功能特色:**
- ✅ 播放/暫停控制
- ✅ 拖動進度條跳轉
- ✅ 音量調整與靜音
- ✅ 時間顯示（當前/總長）
- ✅ 互斥播放（同時只能播放一個，UI 自動同步）
- ✅ 響應式設計

**使用範例:**

```astro
<!-- Card 風格：適合概念曲展示 -->
<AudioPlayer
  src="/content/.gitbook/assets/concept-song.wav"
  title="三區概念曲 - 「現代工業」"
  description="在這座被機械與蒸汽包圍的城市中..."
  variant="card"
/>

<!-- Minimal 風格：節省空間 -->
<AudioPlayer
  src="/content/.gitbook/assets/bgm.wav"
  title="背景音樂"
  variant="minimal"
/>
```

**自動轉換:**
`transformFiles()` 函數會自動將 `{% file %}` 標籤轉換為 AudioPlayer 元件。

---

### 6. Spoiler 元件 (劇透/敏感內容遮罩)

**原始符號:**
```markdown
◼︎◼︎◼︎◼︎
```

**Astro 元件語法:**
```astro
<Spoiler variant="censored">隱藏的內容</Spoiler>
```

**支援的變體 (variant):**
- `blur` (預設) - 模糊效果，懸停預覽，點擊永久顯示
- `click` - 完全隱藏，需點擊按鈕顯示
- `censored` - 黑條遮蓋，帶警告標示

**使用場景:**
- **Echoes 概念曲**: 使用 `censored` 處理 ◼︎ 相關內容
- **故事章節**: 使用 `blur` 處理角色名稱等輕度劇透
- **音樂賞析**: 使用 `click` 隱藏深度分析

**使用範例:**

```astro
<!-- 輕度劇透：模糊效果 -->
故事的最後，<Spoiler variant="blur">U.E.P 選擇了犧牲自己</Spoiler>改變了一切。

<!-- 中度劇透：點擊顯示 -->
真相是：<Spoiler variant="click">整個世界是虛擬實境</Spoiler>

<!-- 重大劇透：黑條遮蓋 -->
◼︎區的真實名稱：<Spoiler variant="censored">虛無大陸</Spoiler>

<!-- 實際應用：概念曲頁面 -->
<h2>◼︎區概念曲 - 「<Spoiler variant="blur">虛無輪迴</Spoiler>」</h2>
<AudioPlayer src="..." title="◼︎區概念曲" variant="card" />
<p>賞析：<Spoiler variant="click">描述命運循環...</Spoiler></p>
```

**自動轉換:**
`transformHiddenContent()` 函數會自動將連續的 `◼︎` 符號（2個以上）轉換為 Spoiler 元件。

---

## 測試頁面

訪問 `/demo-components` 查看所有元件的實際效果展示。

---

## 未來計畫

### 待實作的元件:
1. **ImageGallery** - 圖片展示框
   - 替換 `<figure>` 標籤
   - 支援放大瀏覽（lightbox）
   - 圖片說明文字
   - 畫廊模式

---

## 樣式自訂

所有元件都使用 scoped CSS，可透過全域 CSS 變數進行自訂：

```css
:root {
  --hint-info-bg: rgba(59, 130, 246, 0.1);
  --hint-info-border: rgba(59, 130, 246, 0.5);
  --hint-info-text: #60a5fa;
  
  --mark-yellow-color: #fbbf24;
  --mark-yellow-bg: rgba(251, 191, 36, 0.15);
  
  --player-bg: rgba(17, 24, 39, 0.6);
  --player-accent: #d4af37;
}
```

---

更新日期: 2026-01-20
