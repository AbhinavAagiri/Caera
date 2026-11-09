import { createContext, useContext, type ReactNode } from 'react';

interface AppChrome {
  openHistory: () => void;
  openActivity: () => void;
  openPalette: () => void;
  openNodeStatus: () => void;
}

const AppChromeContext = createContext<AppChrome | null>(null);

export function AppChromeProvider({
  value,
  children,
}: {
  value: AppChrome;
  children: ReactNode;
}): React.JSX.Element {
  return <AppChromeContext.Provider value={value}>{children}</AppChromeContext.Provider>;
}

export function useAppChrome(): AppChrome {
  const context = useContext(AppChromeContext);
  if (!context) throw new Error('useAppChrome must be used inside AppChromeProvider');
  return context;
}
