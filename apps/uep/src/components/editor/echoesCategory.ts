/**
 * Echoes 歌曲分類推導。
 *
 * 分類的唯一來源是歌曲所在的 cluster（`echoes/{cluster}/...`），
 * `metadata.category` 只是推導結果的鏡像，編輯器中唯讀。
 *
 * 這個方向與早期實作相反——原本是「category 優先，cluster 只當
 * fallback」，於是同一首歌可能同時存在兩個互相矛盾的分類來源：
 * 把歌搬到別的 cluster 底下，metadata 裡的舊 category 還在，前台就會
 * 依舊值走差別待遇（劇情歌強制 spoilerLevel 0、清空 spoilerRevisions）。
 * cluster 是檔案樹的實際位置，改不掉也不會偷偷過期，適合當唯一事實。
 */

/** cluster id → 分類值 */
export function deriveSongCategory(clusterId: string): string {
  switch (clusterId) {
    case 'stories':
      return 'story';
    case 'areas':
      return 'area';
    case 'characters':
      return 'character';
    default:
      return 'special';
  }
}

/** 從歌曲頁 id（`echoes/{cluster}/...`）取 cluster id */
export function deriveClusterId(pageId: string): string {
  return pageId.split('/')[1] || 'special';
}

/** 從歌曲頁 id 直接推導分類 */
export function deriveSongCategoryFromPageId(pageId: string): string {
  return deriveSongCategory(deriveClusterId(pageId));
}
