/**
 * 上傳指示器——素材上傳期間的統一視覺回饋（文件站 ned-upload-spinner 的主站對應）。
 *
 * 上傳按鈕原本只換文字或什麼都不換，大檔案時與卡住無從區分。
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
  label = 'uploading…',
  current,
  total,
}: UploadSpinnerProps) {
  const progress =
    current != null && total != null && total > 1 ? ` ${current}/${total}` : '';
  return (
    <>
      <span className="qe-upload-spinner" aria-hidden="true" />
      {label != null && (
        <span className="qe-upload-spinner-label">
          {label}
          {progress}
        </span>
      )}
    </>
  );
}

export default UploadSpinner;
