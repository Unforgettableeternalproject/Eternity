import { useState, useEffect } from 'react';

export default function CookieConsent() {
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem('cookie-consent');
    if (!consent) {
      setTimeout(() => setIsVisible(true), 1000);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem('cookie-consent', 'accepted');
    window.dispatchEvent(new Event('cookie-consent-changed'));
    if (window.innerWidth >= 768) {
      window.dispatchEvent(new Event('cookie-accepted-play-music'));
    }
    closeModal();
  };

  const handleDecline = () => {
    localStorage.setItem('cookie-consent', 'declined');
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
        onClick={closeModal}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 50,
          background: 'rgba(0,0,0,0.4)',
          transition: 'opacity 0.3s',
          opacity: isClosing ? 0 : 1,
        }}
      />

      {/* 彈窗 */}
      <div
        style={{
          position: 'fixed',
          bottom: '2rem',
          left: '50%',
          transform: `translateX(-50%) translateY(${isClosing ? '1rem' : '0'})`,
          zIndex: 50,
          width: '100%',
          maxWidth: '26rem',
          padding: '0 1rem',
          transition: 'opacity 0.3s, transform 0.3s',
          opacity: isClosing ? 0 : 1,
        }}
      >
        <div
          style={{
            background: 'var(--q-paper)',
            border: '1px solid var(--q-line)',
          }}
        >
          {/* 頂部色條 */}
          <div style={{ height: '2px', background: 'var(--q-navy)' }} />

          <div style={{ padding: '1.5rem' }}>
            {/* 標題列 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '0.75rem',
                marginBottom: '1rem',
              }}
            >
              <span
                style={{
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  fontSize: '0.7rem',
                  letterSpacing: '0.08em',
                  color: 'var(--q-navy)',
                  opacity: 0.5,
                }}
              >
                COOKIE
              </span>
              <span
                style={{
                  fontSize: '1.05rem',
                  fontWeight: 700,
                  color: 'var(--q-ink)',
                }}
              >
                使用同意
              </span>
            </div>

            {/* 說明文字 */}
            <p
              style={{
                fontSize: '0.85rem',
                lineHeight: 1.7,
                color: 'var(--q-ink)',
                opacity: 0.7,
                margin: '0 0 1.5rem',
              }}
            >
              我們使用 Cookie
              來保存您的個人化設定和偏好，提供更好的瀏覽體驗。這些資訊僅存儲在您的瀏覽器中。
            </p>

            {/* 按鈕組 */}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={handleDecline}
                style={{
                  flex: 1,
                  padding: '0.625rem 1rem',
                  border: '1px solid var(--q-line)',
                  background: 'transparent',
                  color: 'var(--q-ink)',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = 'var(--q-line)')
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = 'transparent')
                }
              >
                拒絕
              </button>
              <button
                onClick={handleAccept}
                style={{
                  flex: 1,
                  padding: '0.625rem 1rem',
                  border: 'none',
                  background: 'var(--q-navy)',
                  color: 'var(--q-paper)',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
              >
                接受
              </button>
            </div>

            {/* 額外資訊 */}
            <p
              style={{
                fontSize: '0.7rem',
                color: 'var(--q-ink)',
                opacity: 0.4,
                marginTop: '1rem',
                textAlign: 'center',
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              }}
            >
              您可以隨時在瀏覽器設定中清除 Cookie
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
