/**
 * 茶會頁的邀請旗標（S11）
 *
 * `/teatime` 有兩種樣子：被邀請進來的看得到 U.E.P 在喝茶，直接打網址進來的
 * 只有一張空桌子。差別靠這支旗標，不需要新機制——sessionStorage 一項就夠。
 *
 * ## 消費即清（艾斯維爾定案）
 *
 * 讀到的同一刻就清掉，重整就退回空景。這是彩蛋該有的形狀：她剛剛在這裡，
 * 你回頭再看時人已經不在了。
 *
 * ⚠️ 清除必須發生在「讀」而不是「離開頁面」——離開的路徑有太多種
 * （關分頁、上一頁、外部連結），任何一條漏掉就會讓旗標留到下一次，
 * 而症狀是「明明沒被邀請卻有人在」，看起來像功能壞了而不是彩蛋。
 */

const TEATIME_INVITE_KEY = 'uep.teatime.invite.v1';

/** 從休息提醒的「前往茶會」出發時標記。存不進去就只是看到空桌子，不致命 */
export function markTeatimeInvited(): void {
  try {
    sessionStorage.setItem(TEATIME_INVITE_KEY, '1');
  } catch {
    // 隱私模式等寫不進去：茶會頁退化成空景，頁面本身仍然正常
  }
}

/** 讀取並清除。回傳這次進來是不是被邀請的 */
export function consumeTeatimeInvite(): boolean {
  try {
    const invited = sessionStorage.getItem(TEATIME_INVITE_KEY) !== null;
    sessionStorage.removeItem(TEATIME_INVITE_KEY);
    return invited;
  } catch {
    return false;
  }
}
