export { IndexedDbOfflineStoreAdapter } from './adapters/IndexedDbOfflineStoreAdapter';
export { OfflineSyncEngineService } from './services/OfflineSyncEngineService';
export { ReplayOperationService } from './services/ReplayOperationService';
export type { IndexedDbOfflineStoreAdapterConfig } from './adapters/IndexedDbOfflineStoreAdapter';
export type { OfflineSyncEngineServiceConfig } from './services/OfflineSyncEngineService';
export type { ReplayOperationServiceConfig } from './services/ReplayOperationService';
export type {
	CachedResponseRecord,
	OfflineFetch,
	OfflineMutationMethod,
	OfflineOperation,
	OfflineOperationInput,
	OfflineOperationStatus,
	OfflineStore,
	ReplayHeadersPolicy,
	ReplayHooks,
	ReplayDecision,
	ReplayResolutionContext,
	ReplayResolutionPolicy,
	SyncStats
} from './models/OfflineSync.types';

export function buildCacheKey(url: string): string {
	return `GET:${url}`;
}
export { reconcileVersionedDataset } from './utils/reconcileVersionedDataset';
export type {
	ReconciledVersionedDataset,
	ReconcileVersionedDatasetOptions,
	RevisionedDatasetItem
} from './utils/reconcileVersionedDataset';
