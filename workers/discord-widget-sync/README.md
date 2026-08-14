# Discord Widget Sync Worker

這個 Worker 只負責把 `content-api` 的 widget 統計資料同步到 Discord Profile Widget / Game Stats。
它不需要部署 Pages，也不直接讀 D1。

## Discord Developer Portal

Widget 內的 stat value 請使用 `Data` / `Number` 類型，並填入下列 data key：

| Discord data key        | Label 建議     | 來源                 |
| ----------------------- | -------------- | -------------------- |
| `history_total_words`   | History Words  | History 文章總字數   |
| `echoes_song_count`     | Echoes Works   | Echoes 總作品數      |
| `visuals_gallery_count` | Visuals Works  | Visuals 總作品數     |
| `concepts_entity_count` | Entities       | Concepts Entity 總數 |
| `storage_extra_count`   | Extra Articles | Storage extra 文章數 |
| `uep_visitor_count`     | Visitors       | 文件站訪客數         |

## Cloudflare 設定

`wrangler.toml` 每 30 分鐘跑一次 cron，`DISCORD_WIDGET_SYNC_ENABLED` 目前是 `true`。這個開關存在的理由是「secret 或 Discord Portal 欄位尚未就緒時不要誤同步」——初次架設或欄位變動期間應該先設成 `false`。

需要設定的 secrets：

```bash
pnpm --filter discord-widget-sync-worker exec wrangler secret put DISCORD_APP_ID
pnpm --filter discord-widget-sync-worker exec wrangler secret put DISCORD_USER_ID
pnpm --filter discord-widget-sync-worker exec wrangler secret put DISCORD_BOT_TOKEN
pnpm --filter discord-widget-sync-worker exec wrangler secret put SYNC_API_TOKEN
```

初次上線的順序是：先部署並保持 `DISCORD_WIDGET_SYNC_ENABLED=false`，確認手動同步成功後再改成 `true`（現況已完成這一步）。

## 手動同步

```bash
curl -X POST "https://eternity-discord-widget-sync.ptyc4076.workers.dev/api/sync" `
  -H "Authorization: Bearer <SYNC_API_TOKEN>"
```

## 部署

```bash
pnpm deploy:discord-widget
```

Discord 的 profile widget PATCH route 屬於實驗性整合面，若 Discord API 回傳 4xx，先確認 Portal 內的 data key 是否完全一致，再檢查 bot token 是否有此應用的 profile 權限。
