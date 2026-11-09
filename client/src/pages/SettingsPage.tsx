import { NavLink, Navigate, useParams } from 'react-router-dom';
import { Icon, type IconName } from '@/components/icons/Icon';
import { ModulePage } from '@/components/layout/ModulePage';
import { AboutSection } from '@/components/settings/AboutSection';
import { AppearanceSection } from '@/components/settings/AppearanceSection';
import { GeneralSection } from '@/components/settings/GeneralSection';
import { MemorySection } from '@/components/settings/MemorySection';
import { ModelUsageSection } from '@/components/settings/ModelUsageSection';
import { ToolsSection } from '@/components/settings/ToolsSection';
import { VoiceSection } from '@/components/settings/VoiceSection';

const SECTIONS = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'appearance', label: 'Appearance', icon: 'sun' },
  { id: 'provider', label: 'Models & usage', icon: 'node' },
  { id: 'voice', label: 'Voice', icon: 'mic' },
  { id: 'memory', label: 'Memory', icon: 'memory' },
  { id: 'tools', label: 'Tools and permissions', icon: 'shield' },
  { id: 'about', label: 'About CAERA', icon: 'info' },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: IconName }>;

type SectionId = (typeof SECTIONS)[number]['id'];

function isSectionId(value: string | undefined): value is SectionId {
  return SECTIONS.some((section) => section.id === value);
}

function SectionBody({ id }: { id: SectionId }): React.JSX.Element {
  switch (id) {
    case 'appearance':
      return <AppearanceSection />;
    case 'provider':
      return <ModelUsageSection />;
    case 'voice':
      return <VoiceSection />;
    case 'memory':
      return <MemorySection />;
    case 'tools':
      return <ToolsSection />;
    case 'about':
      return <AboutSection />;
    case 'general':
    default:
      return <GeneralSection />;
  }
}

export function SettingsPage(): React.JSX.Element {
  const { section } = useParams<{ section: string }>();

  if (!isSectionId(section)) {
    return <Navigate to="/settings/general" replace />;
  }

  const active = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];

  return (
    <ModulePage
      kicker={
        <>
          Control surface <span className="slash">/</span> <span className="accent">{active.label}</span>
        </>
      }
      title="Settings"
      description="How CAERA starts, looks and asks for permission. Preferences stay on this machine."
    >
      <div className="settings-body">
        <nav aria-label="Settings sections" className="settings-index">
          {SECTIONS.map((item) => (
            <NavLink key={item.id} to={`/settings/${item.id}`}>
              <Icon name={item.icon} size={13} className="shrink-0 text-ink-4" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="settings-content">
          <SectionBody id={section} />
        </div>
      </div>
    </ModulePage>
  );
}
