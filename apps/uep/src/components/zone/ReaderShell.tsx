import React, { useEffect, useState } from 'react';

import { ZONES, type ZoneData } from '../../data/zones';
import { markZoneVisited } from '../../progress/uepFlags';
import BigMapModal from '../ui/BigMapModal';
import IntroOverlay from '../ui/IntroOverlay';
import Minimap from '../ui/Minimap';
import PortalTransition from '../ui/PortalTransition';
import TopBar from '../ui/TopBar';

import { ReaderNudgeProvider } from './ReaderNudge';

interface ReaderShellProps {
  zoneId: string;
  className?: string;
  children: React.ReactNode;
}

export function ReaderShell({ zoneId, className, children }: ReaderShellProps) {
  const [showMap, setShowMap] = useState(false);
  const [homePortal, setHomePortal] = useState(false);
  const [portalZone, setPortalZone] = useState<ZoneData | null>(null);
  const [introZone, setIntroZone] = useState<ZoneData | null>(null);

  useEffect(() => {
    const stored =
      (typeof localStorage !== 'undefined' &&
        localStorage.getItem('uep-theme')) ||
      document.documentElement.getAttribute('data-theme') ||
      'light';
    document.documentElement.setAttribute('data-theme', stored);
  }, []);

  // 標記本頁為 Reader 頁面，讓內容保護系統只在此類頁面上作用
  useEffect(() => {
    document.body.dataset.readerPage = 'true';
    return () => {
      delete document.body.dataset.readerPage;
    };
  }, []);

  /* zone 足跡授旗（`zone:visited:*`）
     2026-07-26 移除、2026-08-10 為了 `uep:all-zone`（走遍五區）引回。

     ⚠️ 當初移除的是「拿它當浮島解鎖儀式的守門」那個用途，不是旗標本身：
     那個條件恆真卻會故障——本 effect 授旗後若遠端 hydrate 才回來就整包
     覆蓋掉，而 effect 不因 hydrate 重跑，四區儀式在首次載入全部消失。
     根因已由 progressStore 的 mergeHydrated 修掉（flags 走 unionAdded，
     空窗期內新增的會保留），所以同一個時機現在是安全的。

     這次**只餵給 uep:all-zone**。解鎖儀式維持「看得到就應該能動作」，
     不再回頭依賴任何單一旗標的時序。 */
  useEffect(() => {
    markZoneVisited(zoneId);
  }, [zoneId]);

  function enterZoneFromMap(targetId: string) {
    const target = ZONES.find((z) => z.id === targetId);
    if (!target) return;
    setShowMap(false);
    if (target.id === zoneId) return;
    setPortalZone(target);
  }

  function showZoneIntro(zone: ZoneData) {
    setShowMap(false);
    setIntroZone(zone);
  }

  function goHome() {
    setHomePortal(true);
  }

  return (
    <ReaderNudgeProvider>
      <div className={className}>
        <TopBar onOpenMap={() => setShowMap(true)} onGoHome={goHome} />

        {children}

        <Minimap
          zones={ZONES}
          currentId={zoneId}
          onExpand={() => setShowMap(true)}
          onPickZone={(targetId) => {
            const target = ZONES.find((z) => z.id === targetId);
            if (!target || target.id === zoneId) return;
            setIntroZone(target);
          }}
          position="bottom-left"
        />

        {showMap && (
          <BigMapModal
            zones={ZONES}
            onClose={() => setShowMap(false)}
            onPick={showZoneIntro}
            onCenterClick={() => {
              setShowMap(false);
              goHome();
            }}
          />
        )}

        <IntroOverlay
          zone={introZone}
          onClose={() => setIntroZone(null)}
          onEnter={() => {
            if (!introZone) return;
            enterZoneFromMap(introZone.id);
            setIntroZone(null);
          }}
        />

        {portalZone && (
          <PortalTransition
            zone={portalZone}
            onDone={() => {
              window.location.href = `/${portalZone.slug}`;
            }}
          />
        )}

        {homePortal && (
          <PortalTransition
            zone={null}
            homeMode
            onDone={() => {
              window.location.href = '/';
            }}
          />
        )}
      </div>
    </ReaderNudgeProvider>
  );
}
