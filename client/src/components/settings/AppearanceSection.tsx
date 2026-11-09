import { Switch } from '@/components/ui/Controls';
import { SegmentedControl } from '@/components/ui/Controls';
import { Note, Panel, PanelHeader, RowGroup, SectionHeading, SettingRow } from '@/components/ui/Panel';
import { Visualizer } from '@/components/visualizer/Visualizer';
import { VisualizerStatePreview } from '@/components/visualizer/VisualizerPreview';
import { VISUALIZER_CONFIG } from '@/components/visualizer/state';
import { usePreferences, type DensityPreference, type ThemePreference } from '@/contexts/PreferencesContext';

export function AppearanceSection(): React.JSX.Element {
  const { preferences, update } = usePreferences();
  const previewState = preferences.visualizerPreview ?? 'idle';

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Appearance"
        description="Two complete palettes for the command deck. Dark is the default."
      />

      <Panel>
        <PanelHeader title="Theme" />
        <RowGroup>
          <SettingRow
            label="Colour palette"
            description="Light uses its own paper-and-ink surfaces, not an inverted dark theme."
          >
            <SegmentedControl<ThemePreference>
              label="Theme"
              value={preferences.theme}
              onChange={(next) => update({ theme: next })}
              options={[
                { value: 'dark', label: 'Dark', icon: 'moon' },
                { value: 'light', label: 'Light', icon: 'sun' },
                { value: 'system', label: 'Match Windows', icon: 'monitor' },
              ]}
            />
          </SettingRow>
          <SettingRow
            label="Interface density"
            description="Compact tightens row heights and page padding for smaller screens."
          >
            <SegmentedControl<DensityPreference>
              label="Interface density"
              value={preferences.density}
              onChange={(next) => update({ density: next })}
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' },
              ]}
            />
          </SettingRow>
          <SettingRow
            label="Reduce motion"
            description="Stops the field's movement and shortens every transition. Windows' own motion setting is respected too."
          >
            <Switch
              label="Reduce motion"
              checked={preferences.reduceMotion}
              onChange={(next) => update({ reduceMotion: next })}
            />
          </SettingRow>
        </RowGroup>
      </Panel>

      <Panel>
        <PanelHeader
          title="Signal field"
          description="The field reads live application state. These controls preview every state until the node publishes presence and voice events."
        />
        <div className="flex flex-col items-center gap-4 px-4 py-6 sm:flex-row sm:items-center sm:gap-8">
          <Visualizer
            state={previewState}
            size={176}
            showCaption
            captionDetail={preferences.visualizerPreview ? 'preview' : 'idle'}
            className="w-[176px] shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] leading-[1.65] text-ink-2">
              {VISUALIZER_CONFIG[previewState].description}
            </p>
            <div className="mt-4">
              <VisualizerStatePreview
                value={preferences.visualizerPreview}
                onChange={(next) => update({ visualizerPreview: next })}
              />
            </div>
            <p className="mt-3 font-mono text-[9px] leading-[1.6] text-ink-3">
              Live mode follows idle, listening, transcribing, thinking, speaking, interrupted,
              error and offline from real state. Listening uses analyser levels from the live
              microphone; speaking follows VoiceStudio playback. Microphone and audio activity are
              never simulated. Preview is a development tool and is labelled in the command deck.
            </p>
          </div>
        </div>
      </Panel>

      <Note>
        Theme, density and motion are saved in this browser. They apply before first paint, so the
        shell never flashes the wrong palette on launch.
      </Note>
    </div>
  );
}
