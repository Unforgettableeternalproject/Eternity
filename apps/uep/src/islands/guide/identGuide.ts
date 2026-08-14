/**
 * 識別證教學的兩個共用常數（2026-08-05）
 *
 * 獨立成檔是為了讓 `IdentCard` 不必 import `GuideRunner`——那會把 overlay
 * 與 islandRuntime 整條鏈拖進識別證的 chunk，而它要的只是兩個字串。
 */

/** 請 IdentCard 把證卡翻開。教學要指的東西全在背面 */
export const IDENT_OPEN_EVENT = 'uep:ident-open';

/**
 * 識別證教學看過了。
 *
 * 借用既有的 flags 而不是新開欄位：flags 本來就是「跟著帳號、跨裝置同步、
 * 只增不減」的集合，`mergeHydrated` 的 union 合流與 DevTools 的授旗／撤銷
 * 工具都是現成的。
 *
 * 識別證教學需要記憶、浮島教學不需要，差別在觸發源：解鎖儀式一輩子只發生
 * 一次，而登入會反覆發生。
 */
export const IDENT_GUIDE_FLAG = 'guide:ident';
