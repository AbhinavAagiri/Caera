import { Visualizer } from '@/components/visualizer/Visualizer';

export function ThinkingIndicator({
  label = 'Working locally',
}: {
  label?: string;
}): React.JSX.Element {
  return (
    <div className="thread-thinking" role="status" aria-live="polite">
      <Visualizer state="thinking" size={17} compact />
      <span>{label}</span>
      <span className="thread-thinking-bars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}
