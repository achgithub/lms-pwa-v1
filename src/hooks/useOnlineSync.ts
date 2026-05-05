import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { importSync } from '../db';
import type { SyncData } from '../types';

async function syncFromServer(): Promise<void> {
  try {
    const data = await api.get<SyncData>('/sync');
    await importSync(data);
  } catch {
    // Stay with cached local data if sync fails
  }
}

export function useOnlineSync(): boolean {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      syncFromServer();
    }
    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if (navigator.onLine) syncFromServer();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
