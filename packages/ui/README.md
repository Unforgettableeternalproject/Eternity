# @uep/ui — 共用 UI 元件

monorepo 的共用元件庫。目前只有 `apps/root` 把它列為 workspace 依賴
（`apps/uep` 沒有，它的視覺語彙走自己的 `DesignLayout` 體系）。

## 服役狀態

匯出的五個元件裡，**只有 `ThemeToggle` 實際被使用中**。這不是遺漏，是刻意
保留——但寫在這裡免得下次有人改錯地方。

| 元件                   | 狀態      | 說明                                                                                           |
| ---------------------- | --------- | ---------------------------------------------------------------------------------------------- |
| `ThemeToggle.astro`    | ✅ 服役中 | `apps/root` 的 `NavigationWithSearch.astro` 使用。含對角切割主題轉場（View Transitions API）。 |
| `Navigation.astro`     | 💤 備用   | **主站實際用的是自己的 `NavigationWithSearch.astro`**，改這支不會有任何效果。                  |
| `LanguageSwitch.astro` | 💤 備用   | 只被上面那支 `Navigation.astro` 內部 import，跟著一起備用。                                    |
| `Footer.astro`         | 💤 備用   | 主站頁尾在各自的 layout 內。                                                                   |
| `Button.tsx`           | 💤 備用   | 34 行的基礎按鈕，沒有消費端。                                                                  |

## 要改導覽列/頁尾時看這裡

先確認你要改的是哪一份：

- 主站導覽列 → `apps/root/src/components/NavigationWithSearch.astro`
- 主站頁尾 → `apps/root/src/layouts/` 底下的 layout
- 文件站兩者 → `apps/uep/src/layouts/DesignLayout.astro`

備用元件若哪天真的接上了（例如開第三個站），把上表的狀態一起更新。
