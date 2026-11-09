import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { ModulePage } from '@/components/layout/ModulePage';
import { ComputerAccessPanel } from '@/components/tools/ComputerAccessPanel';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Indicators';
import { Panel, PanelHeader, SectionHeading } from '@/components/ui/Panel';

const INTEGRATIONS = [
  {
    name: 'VoiceStudio',
    detail: 'Speech input and output through its local API',
    state: 'Local',
  },
  {
    name: 'Model router',
    detail: 'Provider-neutral responses through the local node',
    state: 'Local',
  },
  {
    name: 'Agent runtime',
    detail: 'Plan, permission checks, confirmations and tool execution',
    state: 'Enforced',
  },
  {
    name: 'Obsidian',
    detail: 'Permissioned local vault connector',
    state: 'Connections',
  },
  {
    name: 'Local computer',
    detail: 'Approved apps, folders and closed Windows operations',
    state: 'Permissioned',
  },
  {
    name: 'Knowledge index',
    detail: 'Opt-in cross-application FTS search over approved content',
    state: 'Local',
  },
];

export function ToolsPage(): React.JSX.Element {
  const navigate = useNavigate();

  return (
    <ModulePage
      kicker={
        <>
          Access control <span className="slash">/</span> <span className="accent">Tools</span>
        </>
      }
      title="Tools"
      description="A closed, permissioned tool registry. Connector tools remain separate from local computer access, and neither includes a shell or arbitrary command executor."
      actions={<Chip tone="ok">Enforced locally</Chip>}
    >
      <div className="space-y-7">
        <section>
          <SectionHeading
            title="Connector tools"
            description="Search, read and write operations exposed by connected applications. Each app has its own read, create, edit and delete grants, and every tool call is validated before execution."
            aside={
              <Button
                size="sm"
                variant="primary"
                icon="network"
                onClick={() => navigate('/connections')}
              >
                Open Connections
              </Button>
            }
          />
          <Panel>
            <PanelHeader
              title="Registered executor"
              description="The agent runtime is live with a closed registry. It can use connected Obsidian, Notion, Logseq and Anytype operations, the approved local knowledge index, plus bounded web, calculation and local utilities."
              action={<Chip tone="ok">Enforced</Chip>}
            />
            <div className="px-4 py-3.5">
              <p className="text-[11.5px] leading-[1.65] text-ink-3">
                The agent can select only registered tool names with validated primitive arguments.
                Connector permissions are checked immediately before execution, and every write or
                delete pauses for exact-action approval. Every tool has an independent timeout and
                a structured result; failures are recorded as failures.
              </p>
            </div>
          </Panel>
        </section>

        <section>
          <SectionHeading
            title="Local computer access"
            description="Approve applications and folders, enable only the operations you need, and choose where extra confirmation is required."
          />
          <ComputerAccessPanel />
        </section>

        <section>
          <SectionHeading
            title="Connected tools"
            description="Local services and integrations available to CAERA. Connector status and configuration live on the Connections page."
          />
          <Panel>
            <PanelHeader
              title="Integrations"
              description="VoiceStudio is wired for speech. Model providers are configured under Settings → Models & usage. Connector permissions are managed separately."
              action={<Chip tone="ok">Runtime</Chip>}
            />
            <ul className="divide-y divide-line">
              {INTEGRATIONS.map((tool) => (
                <li key={tool.name} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="grid size-7 shrink-0 place-items-center rounded-[4px] border border-line bg-raised text-ink-3">
                      <Icon name="node" size={13} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[12px] text-ink">{tool.name}</p>
                      <p className="truncate text-[10.5px] text-ink-3">{tool.detail}</p>
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[8px] uppercase tracking-[0.04em] text-ink-4">
                    {tool.state.toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="max-w-[54ch] text-[11px] leading-[1.65] text-ink-3">
            Every local operation is bounded, permission-checked and recorded in Activity. There
            is no unrestricted shell or general filesystem API.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => navigate('/agent')}>
              Open agent
            </Button>
            <Button size="sm" variant="secondary" onClick={() => navigate('/connections')}>
              Manage connections
            </Button>
            <Button size="sm" variant="ghost" onClick={() => navigate('/settings/tools')}>
              Permission notes
            </Button>
          </div>
        </div>
      </div>
    </ModulePage>
  );
}
