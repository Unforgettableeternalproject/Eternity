# PROGRESS

## 2026-05-18

### 預計要做的改動

- 修復首頁文字閱讀區在滾動時被外層轉場攔截的問題（問題 1）。

### 已完成的改動

- 在 `apps/uep/src/components/home/JourneyScene.tsx` 的文字閱讀容器加上 `data-reading-scroll="true"` 標記。
- 在 `apps/uep/src/components/home/HomePage.tsx` 的外層 `wheel` handler 增加閱讀容器判斷：
  - 若 wheel 來源位於文字閱讀容器內，外層轉場邏輯直接略過。
  - 文字容器可滾動時保留內部滾動，不可滾動或到邊界時阻止預設，避免觸發外層轉場。
- 針對「History → 入口」轉場閃爍：
  - 在 `startSectionTransition` 新增 `preserveFade` 選項。
  - wheel 觸發 section transition（History→入口、Storage→Verse）時保留既有 fade 遮罩，避免 fade 與 section veil 交接時出現瞬間閃白/閃底。
- 針對「回入口後立刻下滑導致 offset 與後續轉場失效」：
  - 在桌面 `handleScroll` 補上 gate 被快速跨過時的保底觸發（進入下一區仍會啟動對應 boot transition）。
  - 若已明顯跨過區塊邊界則同步 `previousSceneRef`，避免狀態卡死在舊場景索引而讓後續轉場不再觸發。
- 針對「Storage → Verse 應為一般淡入淡出」：
  - `Storage → Verse` 的自動轉場、wheel 轉場、右側導覽跳轉都改為 `plain` section transition。
  - 保留 `threshold` 特效僅用於導覽欄直接回入口。
- 針對「Storage → Verse 後立刻上滑無法觸發動畫 / offset」：
  - 在 `Verse → Storage` 增加 mobile + desktop 的 up gate 保底判斷。
  - 若桌面快速回拉跨過 gate，仍會補觸發 Storage boot transition；若已明顯跨過則同步 `previousSceneRef` 避免卡死。
- 追補修正（Verse 動畫回不來）：
  - 在 `current === 5` 且判定離開 Verse 的路徑，強制同步 `previousSceneRef = 4`。
  - 避免回到 Storage 後再下滑時仍以 scene=5 判斷，導致 Storage → Verse 轉場不再觸發。
- 追補修正（Storage 直接下滑不觸發 Verse 轉場）：
  - `activeScene === 5` 不再透過被動 scroll reveal 覆寫 `previousSceneRef`。
  - 僅保留 `<0`（Hero/Threshold）由被動 reveal 同步，Verse 必須由 `startSectionTransition` 落位時更新，避免 gate 判斷提前失效。

### 目前進度狀態

- 問題 1、問題 2、以及 Storage ↔ Verse 轉場問題皆已完成程式修正，待使用者實機體感確認。
