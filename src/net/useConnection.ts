import { useSyncExternalStore } from 'react';
import { connectionManager, ConnectionStoreState } from './ConnectionManager';

/**
 * React hook that subscribes to the reactive connectionManager store.
 * Returns live status, rttMs, jitterMs, lossPercent, transportKind, and pcName.
 */
export function useConnection(): ConnectionStoreState {
  return useSyncExternalStore(
    (onStoreChange) => connectionManager.subscribe(onStoreChange),
    () => connectionManager.getState()
  );
}
