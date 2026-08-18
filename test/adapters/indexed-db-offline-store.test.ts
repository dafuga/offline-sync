import { afterEach, describe, expect, it, vi } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import { IndexedDbOfflineStoreAdapter } from '../../src/adapters/IndexedDbOfflineStoreAdapter';
import type { CachedResponseRecord, OfflineOperation } from '../../src/models/OfflineSync.types';

const databaseNames: string[] = [];

afterEach(async () => {
	await Promise.all(databaseNames.splice(0).map((name) => deleteDatabase(name)));
});

describe('IndexedDbOfflineStoreAdapter', () => {
	it('stores cache records, ordered operations, and sync metadata', async () => {
		const adapter = createAdapter();
		const cacheRecord = cachedResponse();
		await adapter.saveCachedResponse(cacheRecord);
		await adapter.upsertOperation(queuedOperation({ id: 'later', createdAt: 20 }));
		await adapter.upsertOperation(queuedOperation({ id: 'first', createdAt: 10 }));

		await expect(adapter.getCachedResponse(cacheRecord.key)).resolves.toEqual(cacheRecord);
		await expect(adapter.getPendingOperations()).resolves.toMatchObject([
			{ id: 'first' },
			{ id: 'later' }
		]);

		await adapter.setLastSyncedAt(1234);
		await expect(adapter.getStats()).resolves.toEqual({
			pendingCount: 2,
			failedCount: 0,
			lastSyncedAt: 1234
		});
		adapter.close();
	});

	it('backs off after an IndexedDB open failure', async () => {
		let now = 1_000;
		const open = vi.fn(() => {
			const request: { onerror?: () => void } = {};
			globalThis.queueMicrotask(() => request.onerror?.());
			return request as unknown as IDBOpenDBRequest;
		});
		const adapter = new IndexedDbOfflineStoreAdapter({
			databaseName: 'broken',
			indexedDb: { open } as unknown as IDBFactory,
			now: () => now,
			openRetryCooldownMs: 60_000
		});

		await expect(adapter.saveCachedResponse(cachedResponse())).rejects.toThrow(
			'Failed to open offline database'
		);
		expect(adapter.isAvailable()).toBe(false);
		await expect(adapter.saveCachedResponse(cachedResponse())).resolves.toBeUndefined();
		expect(open).toHaveBeenCalledTimes(1);

		now += 60_000;
		expect(adapter.isAvailable()).toBe(true);
	});
});

describe('IndexedDbOfflineStoreAdapter migration', () => {
	it('adopts compatible data from an existing database version', async () => {
		const databaseName = `offline-sync-legacy-${globalThis.crypto.randomUUID()}`;
		databaseNames.push(databaseName);
		const cacheRecord = cachedResponse();
		await createLegacyDatabase(databaseName, cacheRecord);
		const adapter = new IndexedDbOfflineStoreAdapter({
			databaseName,
			version: 3,
			indexedDb: indexedDB,
			obsoleteStoreNames: ['dataset_entries']
		});

		await expect(adapter.getCachedResponse(cacheRecord.key)).resolves.toEqual(cacheRecord);
		adapter.close();
	});
});

function createAdapter(): IndexedDbOfflineStoreAdapter {
	const databaseName = `offline-sync-${globalThis.crypto.randomUUID()}`;
	databaseNames.push(databaseName);
	return new IndexedDbOfflineStoreAdapter({ databaseName, version: 3, indexedDb: indexedDB });
}

function cachedResponse(): CachedResponseRecord {
	return {
		key: 'GET:https://example.com/api/items',
		url: 'https://example.com/api/items',
		status: 200,
		statusText: 'OK',
		headers: { 'content-type': 'application/json' },
		body: '{"items":[]}',
		updatedAt: 1
	};
}

function queuedOperation(overrides: Partial<OfflineOperation>): OfflineOperation {
	return {
		id: 'operation',
		url: 'https://example.com/api/items',
		method: 'POST',
		headers: {},
		body: '{}',
		createdAt: 1,
		occurredAt: 1,
		attempts: 0,
		nextRetryAt: 0,
		status: 'pending',
		lastError: null,
		...overrides
	};
}

function deleteDatabase(name: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.deleteDatabase(name);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
		request.onblocked = () => resolve();
	});
}

function createLegacyDatabase(name: string, record: CachedResponseRecord): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(name, 2);
		request.onupgradeneeded = () => {
			request.result.createObjectStore('cache', { keyPath: 'key' }).put(record);
			request.result.createObjectStore('sync_queue', { keyPath: 'id' });
			request.result.createObjectStore('sync_meta', { keyPath: 'key' });
			request.result.createObjectStore('dataset_entries', { keyPath: 'key' });
		};
		request.onsuccess = () => {
			request.result.close();
			resolve();
		};
		request.onerror = () => reject(request.error);
	});
}
