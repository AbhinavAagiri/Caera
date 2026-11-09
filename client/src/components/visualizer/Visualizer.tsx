import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { usePreferences } from '@/contexts/PreferencesContext';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { VISUALIZER_CONFIG, type VisualizerState } from './state';

export interface VisualizerProps {
  state: VisualizerState;
  /** Explicit pixel size for a contained preview. Omit to let the parent fill. */
  size?: number;
  className?: string;
  showCaption?: boolean;
  captionDetail?: string;
  /** Small atmospheric crop for headers and status rows. */
  compact?: boolean;
  /** Real 0–1 input level from the microphone analyser. Omit when no audio is live. */
  level?: number;
}

/**
 * CAERA does not draw its core. The presence is a single custom raster study:
 * black folded material, a seam of restrained heat, and a little mineral grit.
 * Interface state changes the light that falls across it, not the geometry.
 */
export function Visualizer({
  state,
  size,
  className,
  showCaption = false,
  captionDetail,
  compact = false,
  level,
}: VisualizerProps): React.JSX.Element {
  const config = VISUALIZER_CONFIG[state];
  const { preferences } = usePreferences();
  const systemReduced = usePrefersReducedMotion();
  const reduced = preferences.reduceMotion || systemReduced;
  const audioLevel = Math.min(1, Math.max(0, level ?? 0));
  const levelStyle = { '--audio-level': audioLevel.toFixed(3) } as CSSProperties;

  if (compact) {
    const compactSize = size ?? 26;
    return (
      <span
        className={cn('core-compact', className)}
        data-state={state}
        data-reduced={reduced ? 'true' : undefined}
        data-audio={level !== undefined ? 'true' : undefined}
        style={{ width: compactSize, height: compactSize, ...levelStyle }}
        role="img"
        aria-label={`CAERA. ${config.label}.`}
      >
        <img
          className="core-field-image"
          src="/art/caera-field.jpg"
          alt=""
          draggable={false}
          decoding="async"
        />
      </span>
    );
  }

  return (
    <figure
      className={cn('core-figure', className)}
      data-state={state}
      data-reduced={reduced ? 'true' : undefined}
      data-audio={level !== undefined ? 'true' : undefined}
      style={{ ...(size ? { width: size, flexShrink: 0 } : {}), ...levelStyle }}
    >
      <div className="core-field-frame">
        <img
          className="core-field-image"
          src="/art/caera-field.jpg"
          alt=""
          draggable={false}
          decoding="async"
        />
        <span className="core-field-tone" aria-hidden="true" />
        <span className="core-field-aura" aria-hidden="true" />
        <span className="core-field-level" aria-hidden="true" />
        <span className="core-field-vignette" aria-hidden="true" />
      </div>

      {showCaption ? (
        <figcaption className="core-caption">
          <span className="core-caption-label">{config.label}</span>
          <span className="core-caption-detail">{captionDetail ?? config.readout}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}
