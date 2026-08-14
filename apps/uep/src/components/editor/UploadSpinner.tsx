/**
 * 上傳指示器——素材上傳期間的統一視覺回饋。
 *
 * 原本各上傳按鈕只把文字換成「上傳中...」，而「替換」類按鈕連文字都不換、
 * 只有 disabled，大檔案上傳時與卡住無從區分。這個元件把轉圈圖示與進度計數
 * 收在一處，讓兩站所有上傳入口的回饋一致。
 */
import './UploadSpinner.css';

interface UploadSpinnerProps {
  /** 圖示後的文字；傳 null 只顯示圖示（窄按鈕用） */
  label?: string | null;
  /** 多檔上傳時顯示「2/5」 */
  current?: number;
  total?: number;
}

export function UploadSpinner({
  label = '上傳中...',
  current,
  total,
}: UploadSpinnerProps) {
  const progress =
    current != null && total != null && total > 1 ? ` ${current}/${total}` : '';
  return (
    <>
      <span className="ned-upload-spinner" aria-hidden="true" />
      {label != null && (
        <span className="ned-upload-spinner-label">
          {label}
          {progress}
        </span>
      )}
    </>
  );
}

export default UploadSpinner;
