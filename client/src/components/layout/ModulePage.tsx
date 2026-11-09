import type { ReactNode } from 'react';

export function ModulePage({
  kicker,
  title,
  description,
  actions,
  children,
}: {
  kicker: ReactNode;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="module-scroll">
      <div className="module-wrap">
        <header className="module-head">
          <div className="min-w-0">
            <div className="module-kicker">{kicker}</div>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          {actions ? <div className="module-aside">{actions}</div> : null}
        </header>
        {children}
      </div>
    </div>
  );
}
