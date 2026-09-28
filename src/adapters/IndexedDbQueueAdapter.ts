import type { IndexedDbConnectionAdapter } from './IndexedDbConnectionAdapter';
import type { OfflineOperation, SyncStats } from '../models/OfflineSync.types';

export interface IndexedDbQueueAdapterConfig {
	connection: IndexedDbConnectionAdapter;
	store: string;
	meta: string;
	now: () => number;
}

export class IndexedDbQueueAdapter {
	constructor(private readonly config: IndexedDbQueueAdapterConfig) {}

	list(): Promise<OfflineOperation[]> {
		return this.config.connection.request(this.config.store, 'readonly', (store) => store.getAll());
	}

	async pending(limit: number): Promise<OfflineOperation[]> {
		return (await this.list())
			.filter(
				(operation) =>
					['pending', 'syncing'].includes(operation.status) &&
					operation.nextRetryAt <= this.config.now()
			)
			.sort((left, right) => left.createdAt - right.createdAt)
			.slice(0, limit);
	}

	async stats(): Promise<SyncStats> {
		const operations = await this.list();
		const last = await this.config.connection.request<{ value: number } | undefined>(
			this.config.meta,
			'readonly',
			(store) => store.get('lastSyncedAt')
		);
		return {
			pendingCount: operations.filter((item) => ['pending', 'syncing'].includes(item.status))
				.length,
			failedCount: operations.filter((item) => ['failed', 'blocked'].includes(item.status)).length,
			lastSyncedAt: last?.value ?? null
		};
	}

	async retry(id: string): Promise<void> {
		const current = await this.config.connection.request<OfflineOperation | undefined>(
			this.config.store,
			'readonly',
			(store) => store.get(id)
		);
		if (!current) throw new Error('Offline operation not found');
		if (current.status === 'syncing') throw new Error('Cannot retry an active operation');
		await this.config.connection.request(this.config.store, 'readwrite', (store) =>
			store.put({
				...current,
				status: 'pending',
				attempts: 0,
				nextRetryAt: this.config.now(),
				lastError: null
			})
		);
	}
}
