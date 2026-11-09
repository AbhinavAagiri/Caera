import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SegmentedControl, TextField } from '@/components/ui/Controls';
import { Keycap } from '@/components/ui/Indicators';
import { Modal } from '@/components/ui/Overlay';
import { Note, Panel, PanelHeader, RowGroup, SectionHeading, SettingRow } from '@/components/ui/Panel';
import { useToast } from '@/components/ui/Toast';
import { useLocalNode } from '@/contexts/LocalNodeContext';
import { usePreferences, type Preferences } from '@/contexts/PreferencesContext';
import { notifyConversationsChanged } from '@/lib/appEvents';
import { pluralize } from '@/lib/format';
import { api, toApiError } from '@/services/api';

const SHORTCUTS = [
  { label: 'New thread', keys: ['Ctrl', 'N'] },
  { label: 'Search local threads', keys: ['Ctrl', 'K'] },
  { label: 'Conversation history', keys: ['Ctrl', 'B'] },
  { label: 'Activity log', keys: ['Ctrl', 'J'] },
];

export function GeneralSection(): React.JSX.Element {
  const { preferences, update } = usePreferences();
  const { report, refresh } = useLocalNode();
  const { push } = useToast();
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const conversations = report?.storage.conversations ?? 0;
  const messages = report?.storage.messages ?? 0;
  const dataPath = report?.storage.dataDirectory ?? '';

  const copyPath = async (): Promise<void> => {
    if (!dataPath) return;
    try {
      await navigator.clipboard.writeText(dataPath);
      push('Data path copied', { tone: 'success' });
    } catch {
      push('Clipboard unavailable', { detail: 'The browser blocked clipboard access.', tone: 'error' });
    }
  };

  const clearAll = async (): Promise<void> => {
    setClearing(true);
    try {
      const result = await api.clearConversations();
      notifyConversationsChanged();
      refresh();
      setConfirmClear(false);
      push(`Cleared ${pluralize(result.deleted, 'conversation')}`, {
        detail: 'Settings and permissions were kept.',
        tone: 'success',
      });
    } catch (cause) {
      push('Could not clear history', { detail: toApiError(cause).message, tone: 'error' });
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeading
        title="General"
        description="How CAERA starts and behaves on this machine."
      />

      <Panel>
        <PanelHeader title="Profile" description="Used in the welcome line, stored locally." />
        <div className="px-4 py-3.5">
          <TextField
            label="What should CAERA call you?"
            value={preferences.displayName}
            maxLength={40}
            placeholder="Your name"
            onChange={(next) => update({ displayName: next })}
            hint="Optional. Nothing is sent anywhere."
            className="max-w-[320px]"
          />
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Startup" />
        <RowGroup>
          <SettingRow
            label="When CAERA opens"
            description={
              preferences.startup === 'resume' && !preferences.lastConversationId
                ? 'No conversation has been opened yet, so the command deck will show instead.'
                : 'Resume returns to the last conversation you had open.'
            }
          >
            <SegmentedControl<Preferences['startup']>
              label="Startup view"
              value={preferences.startup}
              onChange={(next) => update({ startup: next })}
              options={[
                { value: 'welcome', label: 'Command deck' },
                { value: 'resume', label: 'Resume last' },
              ]}
            />
          </SettingRow>
        </RowGroup>
      </Panel>

      <Panel>
        <PanelHeader
          title="Keyboard shortcuts"
          description="These work anywhere in the workspace, including settings."
        />
        <RowGroup>
          {SHORTCUTS.map((shortcut) => (
            <SettingRow key={shortcut.label} label={shortcut.label}>
              <span className="flex items-center gap-1">
                {shortcut.keys.map((key) => (
                  <Keycap key={key}>{key}</Keycap>
                ))}
              </span>
            </SettingRow>
          ))}
        </RowGroup>
      </Panel>

      <Panel>
        <PanelHeader
          title="Local data"
          description="Conversations live as JSON in the server's data folder. Nothing syncs."
          action={
            <Button size="sm" variant="ghost" icon="copy" onClick={() => void copyPath()}>
              Copy path
            </Button>
          }
        />
        <RowGroup>
          <SettingRow label="Stored conversations">
            <span className="font-mono text-[10.5px] text-ink-3">
              {pluralize(conversations, 'conversation')} · {pluralize(messages, 'message')}
            </span>
          </SettingRow>
          <SettingRow
            label="Delete all conversations"
            description="Removes every conversation from this device. Appearance, voice and permission settings are kept."
          >
            <Button
              size="sm"
              variant="danger"
              onClick={() => setConfirmClear(true)}
              disabled={conversations === 0}
            >
              Delete all
            </Button>
          </SettingRow>
        </RowGroup>
        <div className="border-t border-line px-4 py-2.5">
          <p className="break-all font-mono text-[10px] leading-[1.6] text-ink-3">
            {dataPath || 'Data folder unavailable while the node is offline.'}
          </p>
        </div>
      </Panel>

      <Note>
        Model replies stream through the local node from a configured provider. Push-to-talk transcription and spoken replies
        use VoiceStudio on this machine when it is running. Tool calling is not connected yet.
        Memory is user-approved and local; only relevant entries are included in a request.
      </Note>

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        label="Delete all conversations"
        width={440}
      >
        <div className="px-4 py-3.5">
          <h2 className="text-[13.5px] font-medium text-ink">Delete all conversations?</h2>
          <p className="mt-1.5 text-[12.5px] leading-[1.6] text-ink-3">
            {pluralize(conversations, 'conversation')} and {pluralize(messages, 'message')} will be
            removed from the local store. This cannot be undone.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" disabled={clearing} onClick={() => void clearAll()}>
            {clearing ? 'Deleting…' : 'Delete everything'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
