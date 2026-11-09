import { useCallback, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { IconButton } from '@/components/ui/Button';
import { StatusDot } from '@/components/ui/Indicators';
import { Modal } from '@/components/ui/Overlay';
import { useActivity } from '@/contexts/ActivityContext';
import { useAppChrome } from '@/contexts/AppChromeContext';
import { useLocalNode } from '@/contexts/LocalNodeContext';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useClock } from '@/hooks/useClock';
import { formatRelative } from '@/lib/format';

function routeLabel(pathname: string): string {
  if (pathname === '/') return 'Command deck';
  if (pathname.startsWith('/c/')) return 'Command deck / Thread';
  if (pathname.startsWith('/agent')) return 'Agent operations';
  if (pathname.startsWith('/memory')) return 'Memory';
  if (pathname.startsWith('/knowledge')) return 'Knowledge';
  if (pathname === '/connections/obsidian') return 'Connections / Obsidian vault';
  if (pathname === '/connections/notion') return 'Connections / Notion pages';
  if (pathname === '/connections/logseq') return 'Connections / Logseq graph';
  if (pathname === '/connections/anytype') return 'Connections / Anytype objects';
  if (pathname.startsWith('/connections')) return 'Connections';
  if (pathname.startsWith('/tools')) return 'Tools';
  if (pathname.startsWith('/settings/')) {
    const section = pathname.split('/')[2] ?? '';
    return `Settings / ${section.replace(/-/g, ' ')}`;
  }
  if (pathname.startsWith('/settings')) return 'Settings';
  return 'Unknown route';
}

export function TopBar({
  showMenu,
  onOpenNav,
}: {
  showMenu: boolean;
  onOpenNav: () => void;
}): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const now = useClock();
  const { status } = useLocalNode();
  const { events } = useActivity();
  const { preferences } = usePreferences();
  const { openPalette, openActivity } = useAppChrome();
  const [alertsOpen, setAlertsOpen] = useState(false);
  const closeAlerts = useCallback(() => setAlertsOpen(false), []);

  const failures = useMemo(
    () => events.filter((event) => event.status === 'failed').slice(0, 6),
    [events],
  );

  const time = now.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const operator = preferences.displayName.trim()
    ? preferences.displayName
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? '')
        .join('')
    : 'OP';

  const nodeTone = status === 'online' ? 'online' : status === 'checking' ? 'pending' : 'error';
  const nodeLabel =
    status === 'online' ? 'Node online' : status === 'checking' ? 'Checking node' : 'Node offline';

  return (
    <header className="topbar">
      {showMenu ? (
        <IconButton
          icon="menu"
          label="Open navigation"
          size="sm"
          onClick={onOpenNav}
          className="-ml-1"
        />
      ) : null}

      <div className="topbar-brand">
        <div className="min-w-0">
          <div className="brand-word">CAERA</div>
          <div className="brand-sub hidden sm:block">Personal intelligence</div>
        </div>
      </div>

      <div className="topbar-location hidden lg:flex" aria-label="Current location">
        <strong>{routeLabel(location.pathname)}</strong>
      </div>

      <div className="topbar-actions">
        <span className="topbar-clock hidden sm:block">{time}</span>

        <span className="inline-flex">
          <IconButton
            icon="search"
            label="Search conversations (Ctrl K)"
            size="sm"
            onClick={openPalette}
          />
        </span>

        <span className="relative">
          <IconButton
            icon="bell"
            label={failures.length > 0 ? `Notifications, ${failures.length} alerts` : 'Notifications'}
            size="sm"
            onClick={() => setAlertsOpen(true)}
          />
          {failures.length > 0 ? <span className="notification-dot" aria-hidden="true" /> : null}
        </span>

        <button
          type="button"
          className="operator-button"
          onClick={() => navigate('/settings/general')}
          title="Operator profile and settings"
          aria-label="Operator profile and settings"
        >
          {operator}
        </button>
      </div>

      <Modal
        open={alertsOpen}
        onClose={closeAlerts}
        label="Notifications"
        width={420}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
          <div>
            <h2 className="font-serif text-[22px] leading-tight text-ink">Notifications</h2>
            <p className="mt-1 text-[11px] leading-[1.55] text-ink-3">
              {failures.length > 0
                ? `${failures.length} failed operation${failures.length === 1 ? '' : 's'} in this session`
                : 'No failed operations in this session'}
            </p>
          </div>
          <IconButton icon="close" label="Close notifications" size="sm" onClick={closeAlerts} />
        </div>

        <div className="max-h-[360px] overflow-y-auto">
          {failures.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <span className="mx-auto grid size-8 place-items-center rounded-full border border-line text-ink-3">
                <Icon name="bell" size={14} />
              </span>
              <p className="mt-3 text-[12px] text-ink-2">Clear channel</p>
              <p className="mx-auto mt-1 max-w-[28ch] text-[11px] leading-[1.6] text-ink-3">
                Errors and connection failures land here. Activity holds the full local trace.
              </p>
            </div>
          ) : (
            <ol>
              {failures.map((event) => (
                <li
                  key={event.id}
                  className="border-b border-line px-4 py-3 last:border-b-0"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="mt-[5px] size-[5px] shrink-0 rounded-full bg-[var(--c-danger)]" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-[11.5px] leading-[1.5] text-ink">{event.summary}</p>
                        {event.detail ? (
                          <p className="mt-0.5 text-[10.5px] leading-[1.5] text-ink-3">{event.detail}</p>
                        ) : null}
                        <p className="mt-1 text-[10px] text-ink-4">
                          {event.source} / {event.kind}
                        </p>
                      </div>
                    </div>
                    <time dateTime={event.at} className="shrink-0 font-mono text-[7.5px] text-ink-4">
                      {formatRelative(event.at)}
                    </time>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
          <span className="flex items-center gap-1.5 text-[10.5px] text-ink-4">
            <StatusDot tone={nodeTone} />
            {nodeLabel}
          </span>
          <button
            type="button"
            onClick={() => {
              closeAlerts();
              openActivity();
            }}
            className="text-[11px] text-ink-2 transition-colors hover:text-ink"
          >
            Open activity log
          </button>
        </div>
      </Modal>
    </header>
  );
}
