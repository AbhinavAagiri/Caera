import { useCallback, useMemo, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { ActivityPanel } from '@/components/layout/ActivityPanel';
import { HistoryDrawer } from '@/components/layout/HistoryDrawer';
import { NavRail } from '@/components/layout/NavRail';
import { NodeStatusDialog } from '@/components/layout/NodeStatusDialog';
import { TopBar } from '@/components/layout/TopBar';
import { CommandPalette } from '@/components/search/CommandPalette';
import { Drawer } from '@/components/ui/Overlay';
import { AppChromeProvider } from '@/contexts/AppChromeContext';
import { useHotkeys, type HotkeyMap } from '@/hooks/useHotkeys';
import { useMediaQuery } from '@/hooks/useMediaQuery';

export function AppShell(): React.JSX.Element {
  const navigate = useNavigate();
  const railInline = useMediaQuery('(min-width: 900px)');

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [nodeStatusOpen, setNodeStatusOpen] = useState(false);

  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const closeActivity = useCallback(() => setActivityOpen(false), []);
  const closeNav = useCallback(() => setNavOpen(false), []);
  const closeNodeStatus = useCallback(() => setNodeStatusOpen(false), []);

  const openPalette = useCallback(() => {
    setPaletteOpen(true);
    setHistoryOpen(false);
    setActivityOpen(false);
    setNavOpen(false);
  }, []);

  const openHistory = useCallback(() => {
    setHistoryOpen(true);
    setPaletteOpen(false);
    setActivityOpen(false);
    setNavOpen(false);
  }, []);

  const openActivity = useCallback(() => {
    setActivityOpen(true);
    setPaletteOpen(false);
    setHistoryOpen(false);
    setNavOpen(false);
  }, []);

  const openNodeStatus = useCallback(() => {
    setNodeStatusOpen(true);
  }, []);

  const openNavigation = useCallback(() => {
    setNavOpen(true);
    setHistoryOpen(false);
    setActivityOpen(false);
    setPaletteOpen(false);
  }, []);

  const newThread = useCallback(() => {
    setHistoryOpen(false);
    setActivityOpen(false);
    setNavOpen(false);
    setPaletteOpen(false);
    navigate('/', { state: { focusComposerAt: Date.now() } });
  }, [navigate]);

  const hotkeys = useMemo<HotkeyMap>(
    () => ({
      'mod+k': openPalette,
      'mod+b': openHistory,
      'mod+j': openActivity,
      'mod+n': newThread,
    }),
    [newThread, openActivity, openHistory, openPalette],
  );

  useHotkeys(hotkeys);

  const chrome = useMemo(
    () => ({ openHistory, openActivity, openPalette, openNodeStatus }),
    [openActivity, openHistory, openNodeStatus, openPalette],
  );

  return (
    <AppChromeProvider value={chrome}>
      <div className="app-frame">
        <div className="app-atmosphere" aria-hidden="true" />

        <TopBar showMenu={!railInline} onOpenNav={openNavigation} />

        <div className="app-body">
          {railInline ? (
            <NavRail
              historyOpen={historyOpen}
              activityOpen={activityOpen}
              onNewThread={newThread}
            />
          ) : null}

          <main className="app-main">
            <Outlet />
          </main>
        </div>

        <HistoryDrawer open={historyOpen} onClose={closeHistory} />

        <Drawer
          open={activityOpen}
          onClose={closeActivity}
          label="Activity log"
          side="right"
          width={404}
        >
          <ActivityPanel onClose={closeActivity} />
        </Drawer>

        <Drawer
          open={!railInline && navOpen}
          onClose={closeNav}
          label="Navigation"
          side="left"
          width={296}
        >
          <NavRail
            variant="drawer"
            historyOpen={historyOpen}
            activityOpen={activityOpen}
            onNewThread={newThread}
            onNavigate={closeNav}
            onClose={closeNav}
          />
        </Drawer>

        <NodeStatusDialog open={nodeStatusOpen} onClose={closeNodeStatus} />

        <CommandPalette open={paletteOpen} onClose={closePalette} />
      </div>
    </AppChromeProvider>
  );
}
