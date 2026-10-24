import type { IndexedDbConnectionAdapter } from './IndexedDbConnectionAdapter';
import type { CachedResponseRecord } from '../models/OfflineSync.types';

export interface IndexedDbCacheAdapterConfig {
	connection: IndexedDbConnectionAdapter;
	store: string;
}

export class IndexedDbCacheAdapter {
	constructor(private readonly config: IndexedDbCacheAdapterConfig) {}

	async list(prefix = ''): Promise<CachedResponseRecord[]> {
		return this.config.connection.request<CachedResponseRecord[]>(
			this.config.store,
			'readonly',
			(store) => (prefix ? this.readPrefix(store, prefix) : store.getAll())
		);
	}

	private readPrefix(store: IDBObjectStore, prefix: string): Promise<CachedResponseRecord[]> {
		return new Promise((resolve, reject) => {
			const records: CachedResponseRecord[] = [];
			const cursorRequest = store.openKeyCursor();
			cursorRequest.onerror = () => reject(cursorRequest.error);
			cursorRequest.onsuccess = () => {
				const cursor = cursorRequest.result;
				if (!cursor) return resolve(records);
				if (typeof cursor.key !== 'string') return cursor.continue();
				if (cursor.key < prefix) return cursor.continue(prefix);
				if (!cursor.key.startsWith(prefix)) return resolve(records);
				const recordRequest = store.get(cursor.primaryKey);
				recordRequest.onerror = () => reject(recordRequest.error);
				recordRequest.onsuccess = () => {
					records.push(recordRequest.result as CachedResponseRecord);
					cursor.continue();
				};
			};
		});
	}

	async remove(keys: readonly string[]): Promise<void> {
		if (!keys.length) return;
		await this.config.connection.writeBatch(
			keys.map((key) => ({ store: this.config.store, remove: key }))
		);
	}
}
