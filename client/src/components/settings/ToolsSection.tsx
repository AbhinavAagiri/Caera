import { useNavigate } from 'react-router-dom';
import { ComputerAccessPanel } from '@/components/tools/ComputerAccessPanel';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Indicators';
import { Note, SectionHeading } from '@/components/ui/Panel';

export function ToolsSection(): React.JSX.Element {
  const navigate = useNavigate();

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Tools and permissions"
        description="Explicit approved applications and directories, a closed operation list and per-action confirmation. Connector permissions are managed separately on Connections."
        aside={<Chip tone="ok">Enforced</Chip>}
      />

      <ComputerAccessPanel compact />

      <Note>
        CAERA cannot run a shell, PowerShell, batch file or arbitrary command. Opening an application
        uses only an approved .exe with no arguments; every file action is resolved inside an approved
        directory; and consequential actions always pause for approval.
      </Note>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="max-w-[50ch] text-[11.5px] leading-[1.6] text-ink-3">
          Detailed risk notes for each capability live on the Tools page.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={() => navigate('/connections')}>
            Connections
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate('/tools')}>
            Open tools
          </Button>
        </div>
      </div>
    </div>
  );
}
