# scripts/archive — 一次性腳本歸檔

這裡放**任務已完成、不會再例行執行**的腳本。它們沒有掛在 `package.json` 的
scripts 區塊，保留下來是為了留住「這個專案怎麼從 A 遷移到 B」的操作紀錄，
以及萬一還有資產要補搬時可以直接重跑。

還在服役的工具留在上一層 `scripts/`：`sync*.mjs`、`seed-test-env.mjs`、
`reset-test-env.mjs`、`load-test.mjs`。

## 內容遷移（來源：sibling repo `U.E.P-s-Imaginary-Space`，GitBook 格式）

| 腳本                   | 用途                                        |
| ---------------------- | ------------------------------------------- |
| `migrate-history.mjs`  | 從 `SUMMARY.md` 匯入 history 內容與層級結構 |
| `migrate-concepts.mjs` | concepts 結構化 JSON 資料                   |
| `migrate-echoes.mjs`   | echoes 歌曲資料                             |
| `migrate-storage.mjs`  | storage 收藏資料                            |
| `migrate-visuals.mjs`  | visuals 畫廊資料                            |
| `migrate-homepage.mjs` | 文件站首頁資料                              |

## 主站遷移（Keystatic → D1 + R2，v0.9.8）

| 腳本                          | 用途                           |
| ----------------------------- | ------------------------------ |
| `migrate-root-content.mjs`    | 主站內容匯入 D1                |
| `migrate-root-images.mjs`     | 本地圖片搬進主站 R2            |
| `convert-content-to-html.mjs` | D1 中 markdown content 轉 HTML |

## 種子資料

`seed-about-contact.mjs`、`seed-page-text.mjs`、`seed-homepage.mjs` —— 填充
singleton 資料，正式站已填過。

## Entity Key 工程（S7）

`generate-entity-keys.mjs` 產生候選 → 人工確認另存 `entity-key-map.json` →
`apply-entity-keys.mjs` 套用。`merge-dossier-variants.mjs`、
`reshape-dossier-groups.mjs` 是 S7-B 的資料形狀修正。

## 重跑注意事項

- **相對路徑已對齊本目錄**：五個吃 sibling repo 的 `migrate-*.mjs` 在歸檔時
  把 `import.meta.dirname` 往上的層數從 2 改成 3。若把檔案搬回 `scripts/`，
  記得改回去。
- `convert-content-to-html.mjs`、`seed-about-contact.mjs`、`seed-page-text.mjs`
  用 `process.cwd()` 組暫存 SQL 路徑，**必須從 repo root 執行**，暫存檔會落在
  `scripts/`（不是本目錄）。
- `migrate-history.mjs --clean` 會重置所有 metadata（含手動設定的 icon）。
  增量同步請改用 `pnpm sync`。
