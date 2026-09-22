import type { IndexedDbConnectionAdapter } from './IndexedDbConnectionAdapter';
import type { CachedResponseRecord } from '../models/OfflineSync.types';

export interface IndexedDbCacheAdapterConfig {
	connection: IndexedDbConnectionAdapter;
	store: string;
}

export class IndexedDbCacheAdapter {
	constructor(private readonly config: IndexedDbCacheAdapterConfig) {}

	async list(prefix = ''): Promise<CachedResponseRecord[]> {
		const records = await this.config.connection.request<CachedResponseRecord[]>(
			this.config.store,
			'readonly',
			(store) => store.getAll()
		);
		return records.filter((record) => record.key.startsWith(prefix));
	}

	async remove(keys: readonly string[]): Promise<void> {
		if (!keys.length) return;
		await this.config.connection.writeBatch(
			keys.map((key) => ({ store: this.config.store, remove: key }))
		);
	}
}
