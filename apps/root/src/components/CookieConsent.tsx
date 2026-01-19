import { useState, useEffect } from 'react';

export default function CookieConsent() {
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    // 檢查是否已經回答過
    const consent = localStorage.getItem('cookie-consent');
    console.log('[CookieConsent] Checking consent:', consent);

    if (!consent) {
      console.log('[CookieConsent] No consent found, will show banner in 1s');
      // 延遲顯示，讓頁面先載入
      setTimeout(() => {
        console.log('[CookieConsent] Showing banner now');
        setIsVisible(true);
      }, 1000);
    } else {
      console.log('[CookieConsent] Consent already exists:', consent);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem('cookie-consent', 'accepted');
    // 觸發自定義事件通知其他元件
    window.dispatchEvent(new Event('cookie-consent-changed'));

    // 觸發音樂播放事件（利用用戶互動）- 只在非行動版（md 以上，768px+）
    // 對應 MobileControlPanel 的 md:hidden 條件
    if (window.innerWidth >= 768) {
      window.dispatchEvent(new Event('cookie-accepted-play-music'));
    }

    closeModal();
  };

  const handleDecline = () => {
    localStorage.setItem('cookie-consent', 'declined');
    // 觸發自定義事件通知其他元件
    window.dispatchEvent(new Event('cookie-consent-changed'));
    closeModal();
  };

  const closeModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsVisible(false);
      setIsClosing(false);
    }, 300);
  };

  if (!isVisible) return null;

  return (
    <>
      {/* 背景遮罩 */}
      <div
        className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-50 transition-opacity duration-300 ${
          isClosing ? 'opacity-0' : 'opacity-100'
        }`}
        onClick={closeModal}
      />

      {/* Cookie 同意彈窗 */}
      <div
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-md mx-4 transition-all duration-300 ${
          isClosing ? 'opacity-0 translate-y-4' : 'opacity-100 translate-y-0'
        }`}
      >
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          {/* 頂部裝飾 */}
          <div className="h-1 bg-gradient-to-r from-primary-500 to-secondary-500" />

          <div className="p-6">
            {/* 圖示 */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-100 to-secondary-100 dark:from-primary-950 dark:to-secondary-950 flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-primary-600 dark:text-primary-400"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  Cookie 使用同意
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  個人化您的體驗
                </p>
              </div>
            </div>

            {/* 說明文字 */}
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-6 leading-relaxed">
              我們使用 Cookie 來保存您的個人化設定和偏好，
              提供更好的瀏覽體驗。這些資訊僅存儲在您的瀏覽器中。
            </p>

            {/* 按鈕組 */}
            <div className="flex gap-3">
              <button
                onClick={handleDecline}
                className="flex-1 px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm font-medium"
              >
                拒絕
              </button>
              <button
                onClick={handleAccept}
                className="flex-1 px-4 py-2.5 rounded-lg bg-gradient-to-r from-primary-500 to-secondary-500 text-white hover:from-primary-600 hover:to-secondary-600 transition-all shadow-lg shadow-primary-500/30 text-sm font-medium"
              >
                接受
              </button>
            </div>

            {/* 額外資訊 */}
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-4 text-center">
              您可以隨時在瀏覽器設定中清除 Cookie
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
