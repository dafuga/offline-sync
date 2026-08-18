import type {
	CachedResponseRecord,
	OfflineOperation,
	OfflineStore,
	SyncStats
} from '../../src/models/OfflineSync.types';

export interface MemoryOfflineStore extends OfflineStore {
	operations: Map<string, OfflineOperation>;
	cache: Map<string, CachedResponseRecord>;
}

export function createMemoryOfflineStore(): MemoryOfflineStore {
	const operations = new Map<string, OfflineOperation>();
	const cache = new Map<string, CachedResponseRecord>();
	let lastSyncedAt: number | null = null;

	return {
		operations,
		cache,
		isAvailable: () => true,
		saveCachedResponse: async (record) => void cache.set(record.key, record),
		getCachedResponse: async (key) => cache.get(key) ?? null,
		upsertOperation: async (operation) => void operations.set(operation.id, operation),
		deleteOperation: async (id) => void operations.delete(id),
		getPendingOperations: async (limit = 50) =>
			[...operations.values()]
				.filter((item) => item.status !== 'failed')
				.sort((left, right) => left.createdAt - right.createdAt)
				.slice(0, limit),
		getStats: async (): Promise<SyncStats> => ({
			pendingCount: [...operations.values()].filter((item) => item.status !== 'failed').length,
			failedCount: [...operations.values()].filter((item) => item.status === 'failed').length,
			lastSyncedAt
		}),
		setLastSyncedAt: async (timestamp) => void (lastSyncedAt = timestamp)
	};
}

export function operation(overrides: Partial<OfflineOperation> = {}): OfflineOperation {
	return {
		id: 'operation-1',
		url: 'https://example.com/api/items',
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: '{}',
		createdAt: 1,
		occurredAt: 1,
		attempts: 0,
		nextRetryAt: 1,
		status: 'pending',
		lastError: null,
		...overrides
	};
}
