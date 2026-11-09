import { useNavigate } from 'react-router-dom';
import { ModulePage } from '@/components/layout/ModulePage';
import { Button } from '@/components/ui/Button';

export function NotFoundPage(): React.JSX.Element {
  const navigate = useNavigate();

  return (
    <ModulePage
      kicker={
        <>
          Route <span className="slash">/</span> <span className="accent">Null</span>
        </>
      }
      title="Nothing lives here"
      description="This path is outside the command environment. Every surface CAERA exposes is reachable from the navigation rail."
    >
      <div className="grid min-h-[42vh] place-items-center border-t border-line">
        <div className="max-w-[380px] text-center">
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-4">
            404 / local route
          </p>
          <p className="mt-3 font-serif text-[44px] leading-none text-ink">—</p>
          <p className="mt-4 text-[11.5px] leading-[1.7] text-ink-3">
            The address is valid HTML but not a CAERA surface. Return to the core or open a stored
            thread from history.
          </p>
          <Button className="mt-5" variant="secondary" size="sm" onClick={() => navigate('/')}>
            Return to the core
          </Button>
        </div>
      </div>
    </ModulePage>
  );
}
