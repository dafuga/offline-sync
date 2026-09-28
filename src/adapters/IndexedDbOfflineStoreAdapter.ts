import { IndexedDbQueueAdapter } from './IndexedDbQueueAdapter';
import { IndexedDbCacheAdapter } from './IndexedDbCacheAdapter';
import { IndexedDbConnectionAdapter, type IndexedDbStoreNames } from './IndexedDbConnectionAdapter';
import type {
	CachedResponseRecord,
	OfflineOperation,
	OfflineStore,
	SyncStats
} from '../models/OfflineSync.types';

const DEFAULT_STORES: IndexedDbStoreNames = {
	cache: 'cache',
	queue: 'sync_queue',
	meta: 'sync_meta'
};

export interface IndexedDbOfflineStoreAdapterConfig {
	databaseName: string;
	version?: number;
	stores?: Partial<IndexedDbStoreNames>;
	obsoleteStoreNames?: readonly string[];
	openRetryCooldownMs?: number;
	openTimeoutMs?: number;
	indexedDb?: IDBFactory;
	now?: () => number;
}

export class IndexedDbOfflineStoreAdapter implements OfflineStore {
	private readonly connection: IndexedDbConnectionAdapter;
	private readonly stores: IndexedDbStoreNames;
	private readonly now: () => number;
	private readonly queue: IndexedDbQueueAdapter;
	private readonly cache: IndexedDbCacheAdapter;

	constructor(config: IndexedDbOfflineStoreAdapterConfig) {
		this.stores = { ...DEFAULT_STORES, ...config.stores };
		this.now = config.now ?? Date.now;
		this.connection = createConnection(config, this.stores, this.now);
		this.queue = new IndexedDbQueueAdapter({
			connection: this.connection,
			store: this.stores.queue,
			meta: this.stores.meta,
			now: this.now
		});
		this.cache = new IndexedDbCacheAdapter({
			connection: this.connection,
			store: this.stores.cache
		});
	}

	isAvailable(): boolean {
		return this.connection.isAvailable();
	}

	saveCachedResponse(record: CachedResponseRecord): Promise<void> {
		return this.write(this.stores.cache, record);
	}

	async getCachedResponse(key: string): Promise<CachedResponseRecord | null> {
		if (!this.isAvailable()) return null;
		const result = await this.connection.request<CachedResponseRecord | undefined>(
			this.stores.cache,
			'readonly',
			(store) => store.get(key)
		);
		return result ?? null;
	}

	async upsertOperation(operation: OfflineOperation): Promise<void> {
		if (!this.isAvailable()) throw new Error('Offline storage unavailable');
		return this.write(this.stores.queue, operation);
	}

	async deleteOperation(
		id: string,
		cache: CachedResponseRecord[] = [],
		removeCacheKeys: readonly string[] = []
	): Promise<void> {
		if (!this.isAvailable()) throw new Error('Offline storage unavailable');
		await commitStoreChanges(this.connection, this.stores, {
			operations: [],
			cache,
			removeCacheKeys,
			removeOperations: [id]
		});
	}

	async getPendingOperations(limit = 50): Promise<OfflineOperation[]> {
		if (!this.isAvailable()) return [];
		return this.queue.pending(limit);
	}

	async getStats(): Promise<SyncStats> {
		if (!this.isAvailable()) return { pendingCount: 0, failedCount: 0, lastSyncedAt: null };
		return this.queue.stats();
	}

	setLastSyncedAt(timestamp: number): Promise<void> {
		return this.write(this.stores.meta, { key: 'lastSyncedAt', value: timestamp });
	}

	listOperations(): Promise<OfflineOperation[]> {
		return this.queue.list();
	}
	retryOperation(id: string): Promise<void> {
		return this.queue.retry(id);
	}
	listCachedResponses(prefix = ''): Promise<CachedResponseRecord[]> {
		return this.cache.list(prefix);
	}
	deleteCachedResponses(keys: readonly string[]): Promise<void> {
		return this.cache.remove(keys);
	}

	async commitOperation(
		operation: OfflineOperation,
		cache: CachedResponseRecord[],
		removeCacheKeys: readonly string[] = []
	): Promise<void> {
		return this.commitOperations([operation], cache, removeCacheKeys);
	}

	async commitOperations(
		operations: readonly OfflineOperation[],
		cache: readonly CachedResponseRecord[],
		removeCacheKeys: readonly string[] = []
	): Promise<void> {
		if (!this.isAvailable()) throw new Error('Offline storage unavailable');
		await commitStoreChanges(this.connection, this.stores, { operations, cache, removeCacheKeys });
	}

	close(): void {
		this.connection.close();
	}

	private async write(storeName: string, value: unknown): Promise<void> {
		if (!this.isAvailable()) return;
		await this.connection.request(storeName, 'readwrite', (store) => store.put(value));
	}
}

async function commitStoreChanges(
	connection: IndexedDbConnectionAdapter,
	stores: IndexedDbStoreNames,
	{
		operations,
		cache,
		removeCacheKeys,
		removeOperations = []
	}: {
		operations: readonly OfflineOperation[];
		cache: readonly CachedResponseRecord[];
		removeCacheKeys: readonly string[];
		removeOperations?: readonly string[];
	}
): Promise<void> {
	if (!operations.length && !cache.length && !removeCacheKeys.length && !removeOperations.length)
		return;
	await connection.writeBatch([
		...operations.map((operation) => ({ store: stores.queue, put: operation })),
		...removeOperations.map((id) => ({ store: stores.queue, remove: id })),
		...removeCacheKeys.map((key) => ({ store: stores.cache, remove: key })),
		...cache.map((record) => ({ store: stores.cache, put: record }))
	]);
}

function createConnection(
	config: IndexedDbOfflineStoreAdapterConfig,
	stores: IndexedDbStoreNames,
	now: () => number
): IndexedDbConnectionAdapter {
	return new IndexedDbConnectionAdapter({
		databaseName: config.databaseName,
		version: config.version ?? 1,
		stores: stores,
		obsoleteStoreNames: config.obsoleteStoreNames ?? [],
		openRetryCooldownMs: config.openRetryCooldownMs ?? 60_000,
		indexedDb: config.indexedDb,
		now: now,
		openTimeoutMs: config.openTimeoutMs ?? 3000
	});
}
