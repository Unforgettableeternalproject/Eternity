/**
 * seed 來源讀取的分類與摘要（無副作用，可測）
 *
 * ## 為什麼要有這個檔案
 *
 * 2026-08-02 發現 test 環境的首頁資料整批缺失兩個多月。直接原因是
 * `PUT /api/homepage/:sectionId` 曾多要求一道 JWT（已修），但**讓它能潛伏
 * 那麼久的是這裡**：所有 `fetchSeed*` 都 catch 後回 `[]`，於是
 *
 *   「prod 讀取失敗」與「prod 合法為空」變成同一件事。
 *
 * 部分 seed 偽裝成完整 seed，比缺資料本身更危險——腳本印著綠色的完成訊息，
 * 沒有人會去查那張表是不是空的。
 *
 * 錯誤與空資料必須是不同的控制流：來源讀取失敗一律 throw 到 main 讓
 * exit code 非零；只有真的讀到空集合才回 `[]`，而必要骨架（site_homepage）
 * 連空集合都不接受。
 */

/**
 * 從 apiFetch 丟出的錯誤取 HTTP 狀態碼。取不到（網路層失敗、DNS、逾時）
 * 回 null——那些更該 fail，不該被當成「這筆不存在」。
 */
export function httpStatusOf(err) {
  if (typeof err?.status === 'number') return err.status;
  const match = /^HTTP (\d{3})\b/.exec(err?.message ?? '');
  return match ? Number(match[1]) : null;
}

/**
 * 逐筆讀取（singletons）時，哪些錯誤算「這一筆本來就沒有」。
 *
 * 只有 404 算。500／401／網路失敗都是**讀不到**而不是**不存在**，
 * 把它們當成缺失就會靜默 seed 出一份殘缺的資料。
 */
export function isMissingRecordError(err) {
  return httpStatusOf(err) === 404;
}

/**
 * 必須有內容才算成功的來源。空集合＝上游有問題或讀錯地方，
 * 不是一個可以完成的 seed。
 *
 * `site_homepage` 是 test 首頁的骨架：它空著的話首頁五個 zone 區塊全走
 * fallback 常數，而畫面看起來「只是內容比較少」，不像壞掉。
 */
export const REQUIRED_NON_EMPTY_SOURCES = ['pages', 'site_homepage'];

/**
 * 檢查所有來源的讀取結果，回傳致命問題清單。
 *
 * @param {Record<string, unknown[]>} sources 來源名稱 → 讀到的資料
 * @returns {string[]} 致命問題描述；空陣列代表可以往下寫入
 */
export function collectSourceProblems(sources) {
  const problems = [];
  for (const name of REQUIRED_NON_EMPTY_SOURCES) {
    const rows = sources[name];
    if (!Array.isArray(rows)) {
      problems.push(
        `${name}：來源未讀取（${rows === undefined ? '缺少' : '型別錯誤'}）`
      );
      continue;
    }
    if (rows.length === 0) {
      problems.push(
        `${name}：從 prod 讀到 0 筆。這是 test 環境的必要骨架，不接受空集合`
      );
    }
  }
  return problems;
}

/**
 * 依寫入結果決定 exit code。任何一項失敗都是非零——
 * 「抓到 N 筆、寫入 0 筆」絕不能是成功。
 *
 * @param {Record<string, {ok: number, fail: number}>} results
 */
export function seedExitCode(results) {
  const totalFail = Object.values(results).reduce(
    (sum, r) => sum + (r?.fail ?? 0),
    0
  );
  return totalFail > 0 ? 1 : 0;
}
