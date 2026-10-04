/**
 * 首頁「近期動態」的公告挑選規則
 *
 * - 精選（featured）在前，依日期新到舊
 * - 精選不足 limit 時，以最新的非精選公告補滿，同樣依日期新到舊
 * - 精選超過 limit 時只取最新的 limit 筆
 * - 同一篇（id）只會出現一次
 */
interface UpdateLike {
  id: string;
  date: string;
  featured: boolean;
  createdAt?: string;
}

function byDateDesc(a: UpdateLike, b: UpdateLike): number {
  const diff = new Date(b.date).getTime() - new Date(a.date).getTime();
  if (diff !== 0) return diff;
  return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
}

export function pickHomepageUpdates<T extends UpdateLike>(
  updates: readonly T[],
  limit: number
): T[] {
  if (limit <= 0) return [];

  const seen = new Set<string>();
  const unique = updates.filter((u) => {
    if (seen.has(u.id)) return false;
    seen.add(u.id);
    return true;
  });

  const featured = unique.filter((u) => u.featured).sort(byDateDesc);
  const others = unique.filter((u) => !u.featured).sort(byDateDesc);

  return [...featured, ...others].slice(0, limit);
}
