/**
 * 將頁面 id／slug 正規化成 D1 與 tree API 使用的逐段 percent-encoded 格式。
 */
export function canonicalizePagePath(path: string): string {
  return path
    .split('/')
    .map((segment) => {
      try {
        return encodeURIComponent(decodeURIComponent(segment));
      } catch {
        // malformed percent sequence 視為原始字面內容，避免路由處理直接拋錯。
        return encodeURIComponent(segment);
      }
    })
    .join('/');
}

/** 比較可能分別來自 route 與 tree API 的頁面 id／slug。 */
export function isSamePagePath(left: string, right: string): boolean {
  return canonicalizePagePath(left) === canonicalizePagePath(right);
}
