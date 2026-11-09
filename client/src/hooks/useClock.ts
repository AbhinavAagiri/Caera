import { useEffect, useState } from 'react';

/** Local wall clock, refreshed on a one-second cadence. */
export function useClock(): Date {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}
