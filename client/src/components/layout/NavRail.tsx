import { NavLink, useLocation } from 'react-router-dom';
import { CaeraMark, Icon, type IconName } from '@/components/icons/Icon';
import { IconButton } from '@/components/ui/Button';
import { StatusDot } from '@/components/ui/Indicators';
import { useAppChrome } from '@/contexts/AppChromeContext';
import { useLocalNode } from '@/contexts/LocalNodeContext';
import { cn } from '@/lib/cn';

interface NavRailProps {
  variant?: 'rail' | 'drawer';
  historyOpen: boolean;
  activityOpen: boolean;
  onNewThread: () => void;
  onNavigate?: () => void;
  onClose?: () => void;
}

interface ItemProps {
  label: string;
  active: boolean;
  onClick?: () => void;
  to?: string;
  onNavigate?: () => void;
  icon?: IconName;
  mark?: boolean;
  title?: string;
}

function RailItem({
  label,
  active,
  onClick,
  to,
  onNavigate,
  icon,
  mark = false,
  title,
}: ItemProps): React.JSX.Element {
  const content = (
    <>
      {mark ? (
        <span className="rail-icon text-current">
          <CaeraMark size={16} />
        </span>
      ) : icon ? (
        <Icon name={icon} size={16} className="rail-icon" />
      ) : null}
      <span className="rail-label">{label}</span>
    </>
  );

  if (to) {
    return (
      <NavLink
        to={to}
        onClick={onNavigate}
        title={title ?? label}
        data-active={active}
        className="rail-item"
      >
        {content}
      </NavLink>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      data-active={active}
      className="rail-item"
    >
      {content}
    </button>
  );
}

export function NavRail({
  variant = 'rail',
  historyOpen,
  activityOpen,
  onNewThread,
  onNavigate,
  onClose,
}: NavRailProps): React.JSX.Element {
  const location = useLocation();
  const node = useLocalNode();
  const { openHistory, openActivity, openNodeStatus } = useAppChrome();
  const isDrawer = variant === 'drawer';

  const coreActive = location.pathname === '/' || location.pathname.startsWith('/c/');
  const settingsActive = location.pathname.startsWith('/settings');
  const nodeTone =
    node.status === 'online' ? 'online' : node.status === 'checking' ? 'pending' : 'error';

  return (
    <aside
      aria-label="CAERA command navigation"
      className={cn('nav-rail', isDrawer && 'nav-drawer')}
    >
      {isDrawer ? (
        <div className="nav-drawer-head">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded-[5px] border border-line bg-raised text-accent">
              <CaeraMark size={19} />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold tracking-[0.22em] text-ink">CAERA</span>
              <span className="mt-0.5 block text-[10px] tracking-normal text-ink-4">
                Command navigation
              </span>
            </span>
          </span>
          {onClose ? (
            <IconButton icon="close" label="Close navigation" size="sm" onClick={onClose} />
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onNewThread}
        className="rail-new"
        title="New thread (Ctrl N)"
        aria-label="New thread"
      >
        <Icon name="plus" size={16} />
        {isDrawer ? <span>New thread</span> : null}
      </button>

      <nav className="rail-items" aria-label="Primary">
        <RailItem
          to="/"
          label="Core"
          mark
          active={coreActive}
          onNavigate={onNavigate}
          title="Assistant core"
        />
        <RailItem
          label="Threads"
          icon="chat"
          active={historyOpen}
          onClick={openHistory}
          title="Conversation history"
        />
        <RailItem
          to="/agent"
          label="Agent"
          icon="cpu"
          active={location.pathname.startsWith('/agent')}
          onNavigate={onNavigate}
          title="Controlled agent execution"
        />
        <RailItem
          to="/memory"
          label="Memory"
          icon="memory"
          active={location.pathname.startsWith('/memory')}
          onNavigate={onNavigate}
        />
        <RailItem
          to="/knowledge"
          label="Knowledge"
          icon="search"
          active={location.pathname.startsWith('/knowledge')}
          onNavigate={onNavigate}
          title="Unified local knowledge index"
        />
        <RailItem
          to="/connections"
          label="Connections"
          icon="network"
          active={location.pathname.startsWith('/connections')}
          onNavigate={onNavigate}
        />
        <RailItem
          to="/tools"
          label="Tools"
          icon="tools"
          active={location.pathname.startsWith('/tools')}
          onNavigate={onNavigate}
        />
        <RailItem
          label="Activity"
          icon="activity"
          active={activityOpen}
          onClick={openActivity}
          title="Activity log (Ctrl J)"
        />
        <RailItem
          to="/settings/general"
          label="Settings"
          icon="settings"
          active={settingsActive}
          onNavigate={onNavigate}
        />
      </nav>

      <div className="rail-spacer" />

      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          openNodeStatus();
        }}
        className="rail-node"
        title={node.status === 'online' ? 'Local node online' : 'Inspect local node'}
      >
        <StatusDot tone={nodeTone} />
        <span>
          {node.status === 'online'
            ? 'Node online'
            : node.status === 'checking'
              ? 'Checking'
              : 'Node offline'}
        </span>
        {isDrawer ? (
          <span className="ml-auto text-ink-4">
            {node.report ? `v${node.report.version}` : '127.0.0.1'}
          </span>
        ) : null}
      </button>
    </aside>
  );
}
