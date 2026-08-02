import React, { useEffect, useState } from 'react';

import { ZONES, type ZoneData } from '../../data/zones';
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

  // 2026-07-26 移除 zone 足跡授旗（`zone:visited:*`）。
  // 它是 S6 通用解鎖小物件的浮現條件，四 zone 改用專屬儀式後已無消費端；
  // 留著反而有害——這個 mount effect 與 setAdapter 的遠端 hydrate 互相
  // 競態，旗被覆蓋掉時 effect 不會重跑，儀式要重新整理才出現。
  // 詳見 islands/unlockRitual.ts 的說明。

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
