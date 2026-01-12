# 背景音樂資料夾

將你的音樂檔案放置在此資料夾中，音樂播放器會自動讀取。

## 📁 檔案位置

**音樂檔案應放在：**
```
Eternity/apps/root/public/music/
```

**實際路徑範例：**
- `C:\Users\Bernie\source\repos\Unforgettableeternalproject\Eternity\apps\root\public\music\your-song.mp3`

**網頁存取路徑：**
- `/music/your-song.mp3`

## 🎵 使用方式

1. 將音樂檔案（.mp3, .ogg, .wav 等）放入 `public/music/` 資料夾
2. 編輯 `src/components/LeftSidebar.astro` 檔案
3. 在第 32-35 行找到 `tracks` 陣列，更新音樂列表：

```typescript
const tracks = [
  { 
    title: '我的第一首歌', 
    artist: '藝術家名稱', 
    url: '/music/song1.mp3'  // 對應 public/music/song1.mp3
  },
  { 
    title: '我的第二首歌', 
    artist: '另一位藝術家', 
    url: '/music/song2.mp3'  // 對應 public/music/song2.mp3
  },
  // 可以添加更多曲目...
];
```

## ✨ 新功能 - 可拖動浮島

- **拖動面板**：點擊頂部彩色區域（顯示「拖動面板」）並拖動即可移動
- **收合/展開**：點擊右上角的箭頭按鈕可以收合面板
- **記憶位置**：您的拖動位置會自動儲存，下次訪問時會保持在相同位置

## 💡 建議格式

- **格式**: MP3 或 OGG（較好的瀏覽器相容性）
- **品質**: 128-192 kbps（平衡檔案大小與音質）
- **檔案大小**: 建議每首 < 5MB

## ⚠️ 注意事項

- 確保你有音樂的使用權限（版權問題）
- 較大的音樂檔案會影響網站載入速度
- 建議使用無版權音樂或自己創作的音樂
- 支援的格式：MP3, OGG, WAV, M4A

## 🎼 免費音樂資源推薦

- [YouTube Audio Library](https://www.youtube.com/audiolibrary)
- [Incompetech](https://incompetech.com/music/royalty-free/)
- [Free Music Archive](https://freemusicarchive.org/)
- [Bensound](https://www.bensound.com/)
