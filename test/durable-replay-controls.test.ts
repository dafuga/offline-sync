import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbOfflineStoreAdapter } from '../src/adapters/IndexedDbOfflineStoreAdapter';
import { OfflineSyncEngineService } from '../src/services/OfflineSyncEngineService';
import { operation, createMemoryOfflineStore } from './helpers/memoryOfflineStore';

describe('durable replay controls', () => {
	it('rejects a queue write when storage is unavailable', async () => {
		const store = new IndexedDbOfflineStoreAdapter({ databaseName: 'unavailable' });
		vi.spyOn(store, 'isAvailable').mockReturnValue(false);
		await expect(store.upsertOperation(operation())).rejects.toThrow(/unavailable/i);
	});

	it('does not advance last successful sync after a failed or empty flush', async () => {
		const store = createMemoryOfflineStore();
		const engine = new OfflineSyncEngineService({
			store,
			isOnline: () => true,
			fetch: async () => new Response('', { status: 503 })
		});
		await engine.flushQueue();
		expect((await store.getStats()).lastSyncedAt).toBeNull();
		store.operations.set('operation-1', operation());
		await engine.flushQueue();
		expect((await store.getStats()).lastSyncedAt).toBeNull();
	});

	it('preserves work when application reconciliation fails', async () => {
		const store = createMemoryOfflineStore();
		const engine = new OfflineSyncEngineService({
			store,
			isOnline: () => true,
			fetch: async () => Response.json({ id: 4 }),
			onResolved: async () => {
				throw new Error('disk full');
			}
		});
		await engine.replayQueuedOperation(operation());
		expect(store.operations.get('operation-1')).toMatchObject({ lastError: 'disk full' });
		expect((await store.getStats()).lastSyncedAt).toBeNull();
	});
});

describe('replay recovery and atomic data', () => {
	it('defers unmet dependencies without making requests or consuming attempts', async () => {
		const store = createMemoryOfflineStore();
		const fetch = vi.fn();
		const engine = new OfflineSyncEngineService({
			store,
			isOnline: () => true,
			fetch,
			canReplay: () => false
		});
		store.operations.set('operation-1', operation());
		await engine.flushQueue();
		expect(fetch).not.toHaveBeenCalled();
		expect(store.operations.get('operation-1')).toMatchObject({ attempts: 0, status: 'pending' });
	});

	it('blocks a conflict until explicitly retried, without deleting the payload', async () => {
		const store = new IndexedDbOfflineStoreAdapter({
			databaseName: 'conflict',
			indexedDb: new IDBFactory()
		});
		const fetch = vi.fn(async () => new Response('changed remotely', { status: 409 }));
		const engine = new OfflineSyncEngineService({
			store,
			isOnline: () => true,
			fetch,
			classifyResponse: () => ({ status: 'blocked', reason: 'conflict' })
		});
		await engine.replayQueuedOperation(operation());
		await engine.flushQueue();
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(await store.listOperations()).toEqual([
			expect.objectContaining({ status: 'blocked', body: '{}' })
		]);
		await store.retryOperation('operation-1');
		expect(await store.getPendingOperations()).toHaveLength(1);
		store.close();
	});
});

describe('atomic storage recovery', () => {
	it('discards an operation and restores its cache in the same durable transaction', async () => {
		const config = { databaseName: 'discard', indexedDb: new IDBFactory() };
		const store = new IndexedDbOfflineStoreAdapter(config);
		const original = {
			key: 'task',
			url: '/tasks/1',
			status: 200,
			statusText: 'OK',
			headers: {},
			body: '{"name":"original"}',
			updatedAt: 1
		};
		await store.commitOperation(operation(), [{ ...original, body: '{"name":"pending"}' }]);
		await store.deleteOperation('operation-1', [original]);
		store.close();
		const reopened = new IndexedDbOfflineStoreAdapter(config);
		expect(await reopened.listOperations()).toEqual([]);
		expect(await reopened.getCachedResponse('task')).toEqual(original);
		reopened.close();
	});
	it('commits an operation and its projected cache together and recovers after reopening', async () => {
		const indexedDb = new IDBFactory();
		const config = { databaseName: 'atomic', indexedDb };
		const store = new IndexedDbOfflineStoreAdapter(config);
		const cached = {
			key: 'task',
			url: '/api/tasks',
			status: 200,
			statusText: 'OK',
			headers: {},
			body: '{"id":-1}',
			updatedAt: 1
		};
		await store.commitOperation(operation({ status: 'syncing' }), [cached]);
		store.close();
		const reopened = new IndexedDbOfflineStoreAdapter(config);
		expect(await reopened.getCachedResponse('task')).toEqual(cached);
		expect(await reopened.getPendingOperations()).toHaveLength(1);
		await reopened.deleteCachedResponses(['task']);
		expect(await reopened.getCachedResponse('task')).toBeNull();
		reopened.close();
	});
});
