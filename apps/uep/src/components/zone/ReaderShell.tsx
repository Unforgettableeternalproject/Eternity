import React, { useEffect, useState } from 'react';
import { ZONES, type ZoneData } from '../../data/zones';
import BigMapModal from '../ui/BigMapModal';
import Minimap from '../ui/Minimap';
import PortalTransition from '../ui/PortalTransition';
import TopBar from '../ui/TopBar';
import IntroOverlay from '../ui/IntroOverlay';

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
      'dark';
    document.documentElement.setAttribute('data-theme', stored);
  }, []);

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
    <div className={className}>
      <TopBar onOpenMap={() => setShowMap(true)} onGoHome={goHome} />

      {children}

      <Minimap
        zones={ZONES}
        currentId={zoneId}
        onExpand={() => setShowMap(true)}
        onPickZone={enterZoneFromMap}
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
  );
}
