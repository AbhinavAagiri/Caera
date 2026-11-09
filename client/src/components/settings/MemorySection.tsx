import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Controls';
import { Chip } from '@/components/ui/Indicators';
import { Note, Panel, PanelHeader, RowGroup, SectionHeading, SettingRow } from '@/components/ui/Panel';
import { useToast } from '@/components/ui/Toast';
import { useLocalNode } from '@/contexts/LocalNodeContext';
import { pluralize } from '@/lib/format';
import { api, toApiError } from '@/services/api';

export function MemorySection(): React.JSX.Element {
  const navigate = useNavigate();
  const { report, refresh } = useLocalNode();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  const paused = report?.memory.state === 'paused';
  const entries = report?.memory.entries ?? 0;

  const toggle = async (next: boolean): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await api.updateMemorySettings(next);
      refresh();
      push(next ? 'Memory paused' : 'Memory resumed', {
        detail: next
          ? 'Existing approved entries remain available for recall.'
          : 'New approved entries can be stored.',
      });
    } catch (cause) {
      push('Could not change memory', { detail: toApiError(cause).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Memory"
        description="User-approved facts and context, stored locally in SQLite. Nothing is distilled from conversations automatically."
        aside={paused ? <Chip tone="warn">Paused</Chip> : <Chip tone="ok">Ready</Chip>}
      />

      <Panel>
        <PanelHeader
          title="Collection"
          description="Pausing blocks new entries. Existing memories stay available for recall and can still be edited."
        />
        <RowGroup>
          <SettingRow
            label="Allow new approved memories"
            description="Only entries you create explicitly are stored."
          >
            <Switch
              label="Allow new approved memories"
              checked={!paused}
              disabled={busy}
              onChange={(next) => void toggle(!next)}
            />
          </SettingRow>
          <SettingRow label="Stored entries">
            <span className="font-mono text-[10.5px] text-ink-3">
              {pluralize(entries, 'entry', 'entries')}
            </span>
          </SettingRow>
          <SettingRow
            label="Review and manage"
            description="Search, edit, link, delete, or clear entries on the Memory page."
          >
            <Button size="sm" variant="secondary" icon="memory" onClick={() => navigate('/memory')}>
              Open memory
            </Button>
          </SettingRow>
        </RowGroup>
      </Panel>

      <Panel>
        <PanelHeader title="What reaches the provider" />
        <div className="space-y-2 px-4 py-3.5 text-[11.5px] leading-[1.65] text-ink-3">
          <p>
            Before a reply, the local node scores your message against the memory store. At most
            six relevant entries plus two linked entries are added to the selected model's system
            instruction, capped at 1,800 characters.
          </p>
          <p>
            Only each entry&apos;s kind, subject, and content are sent. Reasons, source excerpts,
            and the rest of the store stay on this device.
          </p>
        </div>
      </Panel>

      <Note>
        Memory lives in the same local SQLite database as your conversations. It is never uploaded
        or synced, and clearing it does not delete your chats.
      </Note>
    </div>
  );
}
