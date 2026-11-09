import { cn } from '@/lib/cn';
import {
  VISUALIZER_CONFIG,
  VISUALIZER_STATES,
  type VisualizerState,
} from './state';

function chipClass(active: boolean): string {
  return cn(
    'h-[28px] rounded-md border px-3 text-[11px] font-medium leading-none transition-colors',
    active
      ? 'border-line-strong bg-surface text-ink'
      : 'border-line bg-transparent text-ink-3 hover:border-line-strong hover:text-ink-2',
  );
}

/**
 * Phase 1 preview. Once the node publishes presence and voice events, the
 * instrument reads those directly and this control can be removed.
 */
export function VisualizerStatePreview({
  value,
  onChange,
}: {
  value: VisualizerState | null;
  onChange: (next: VisualizerState | null) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Field state preview">
      <button
        type="button"
        aria-pressed={value === null}
        onClick={() => onChange(null)}
        className={chipClass(value === null)}
      >
        Live
      </button>
      {VISUALIZER_STATES.map((state) => (
        <button
          key={state}
          type="button"
          aria-pressed={value === state}
          onClick={() => onChange(state)}
          className={chipClass(value === state)}
        >
          {VISUALIZER_CONFIG[state].label}
        </button>
      ))}
    </div>
  );
}
