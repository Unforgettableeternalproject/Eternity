/**
 * UEP 讀者帳號模組 — barrel（消費端統一入口）
 */

export {
  uepReaderAuth,
  getReaderAuth,
  GUEST_ALIAS,
  WITNESSED_PREFIX,
  READER_SESSION_KEY,
  AUTH_CHANGE_EVENT,
} from './readerAuth';
export type { ReaderSession, AuthResult } from './readerAuth';
export { useReaderAuth } from './useReaderAuth';
