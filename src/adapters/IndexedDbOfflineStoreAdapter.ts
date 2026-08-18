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
	indexedDb?: IDBFactory;
	now?: () => number;
}

export class IndexedDbOfflineStoreAdapter implements OfflineStore {
	private readonly connection: IndexedDbConnectionAdapter;
	private readonly stores: IndexedDbStoreNames;
	private readonly now: () => number;

	constructor(config: IndexedDbOfflineStoreAdapterConfig) {
		this.stores = { ...DEFAULT_STORES, ...config.stores };
		this.now = config.now ?? Date.now;
		this.connection = new IndexedDbConnectionAdapter({
			databaseName: config.databaseName,
			version: config.version ?? 1,
			stores: this.stores,
			obsoleteStoreNames: config.obsoleteStoreNames ?? [],
			openRetryCooldownMs: config.openRetryCooldownMs ?? 60_000,
			indexedDb: config.indexedDb,
			now: this.now
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

	upsertOperation(operation: OfflineOperation): Promise<void> {
		return this.write(this.stores.queue, operation);
	}

	async deleteOperation(id: string): Promise<void> {
		if (!this.isAvailable()) return;
		await this.connection.request(this.stores.queue, 'readwrite', (store) => store.delete(id));
	}

	async getPendingOperations(limit = 50): Promise<OfflineOperation[]> {
		if (!this.isAvailable()) return [];
		const operations = await this.getAllOperations();
		return operations
			.filter((operation) => operation.status !== 'failed' && operation.nextRetryAt <= this.now())
			.sort((left, right) => left.createdAt - right.createdAt)
			.slice(0, limit);
	}

	async getStats(): Promise<SyncStats> {
		if (!this.isAvailable()) return emptyStats();
		const operations = await this.getAllOperations();
		const lastSyncedAt = await this.getLastSyncedAt();
		return {
			pendingCount: operations.filter((item) => item.status !== 'failed').length,
			failedCount: operations.filter((item) => item.status === 'failed').length,
			lastSyncedAt
		};
	}

	setLastSyncedAt(timestamp: number): Promise<void> {
		return this.write(this.stores.meta, { key: 'lastSyncedAt', value: timestamp });
	}

	close(): void {
		this.connection.close();
	}

	private async write(storeName: string, value: unknown): Promise<void> {
		if (!this.isAvailable()) return;
		await this.connection.request(storeName, 'readwrite', (store) => store.put(value));
	}

	private getAllOperations(): Promise<OfflineOperation[]> {
		return this.connection.request(this.stores.queue, 'readonly', (store) => store.getAll());
	}

	private async getLastSyncedAt(): Promise<number | null> {
		const result = await this.connection.request<{ key: string; value: number } | undefined>(
			this.stores.meta,
			'readonly',
			(store) => store.get('lastSyncedAt')
		);
		return result?.value ?? null;
	}
}

function emptyStats(): SyncStats {
	return { pendingCount: 0, failedCount: 0, lastSyncedAt: null };
}
