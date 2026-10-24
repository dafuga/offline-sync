import { afterEach, describe, expect, it, vi } from 'vitest';
import { indexedDB, IDBDatabase as Db, IDBObjectStore as Store } from 'fake-indexeddb';
import { IndexedDbOfflineStoreAdapter } from '../../src/adapters/IndexedDbOfflineStoreAdapter';
import type { CachedResponseRecord, OfflineOperation } from '../../src/models/OfflineSync.types';

const databaseNames: string[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(databaseNames.splice(0).map((name) => deleteDatabase(name)));
});

it('reads metadata without materializing unrelated large cached response bodies', async () => {
	const adapter = createAdapter();
	const metadata = { ...cachedResponse(), key: '/@downloads/1', body: '{"ready":true}' };
	const unicode = { ...metadata, key: '/@downloads/\uffff/2' };
	try {
		await adapter.saveCachedResponse(metadata);
		await adapter.saveCachedResponse(unicode);
		for (const key of ['!before-metadata', '/projects/1/plan-pages'])
			await adapter.saveCachedResponse({ ...cachedResponse(), key, body: 'x'.repeat(2 ** 20) });
		let materializedBytes = 0;
		const clone = globalThis.structuredClone;
		vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
			if (value && typeof value === 'object' && 'body' in value && typeof value.body === 'string')
				materializedBytes += value.body.length;
			return clone(value, options);
		});
		await expect(adapter.listCachedResponses('/@downloads/')).resolves.toEqual([metadata, unicode]);
		expect(materializedBytes).toBe(metadata.body.length + unicode.body.length);
		await expect(adapter.listCachedResponses('/@missing/')).resolves.toEqual([]);
	} finally {
		adapter.close();
	}
});

describe('IndexedDbOfflineStoreAdapter', () => {
	it.each(['open', 'read', 'cache-write', 'queue-write', 'atomic-write', 'concurrent-read'])(
		'stores cache records, ordered operations, and sync metadata after %s lifecycle',
		async (lifecycle) => {
			const adapter = createAdapter();
			const cacheRecord = cachedResponse();
			await adapter.saveCachedResponse(cacheRecord);
			if (lifecycle === 'cache-write') {
				closeNextConnection();
				await adapter.saveCachedResponse(cacheRecord);
			}
			if (lifecycle === 'queue-write') closeNextConnection();
			await adapter.upsertOperation(queuedOperation({ id: 'later', createdAt: 20 }));
			await adapter.upsertOperation(queuedOperation({ id: 'first', createdAt: 10 }));

			if (lifecycle === 'atomic-write') {
				closeNextConnection();
				await adapter.commitOperation(queuedOperation({ id: 'first', createdAt: 10 }), [
					cacheRecord
				]);
			}
			if (lifecycle === 'read' || lifecycle === 'concurrent-read') closeNextConnection();
			if (lifecycle === 'concurrent-read')
				await expect(
					Promise.all([
						adapter.getCachedResponse(cacheRecord.key),
						adapter.getCachedResponse(cacheRecord.key)
					])
				).resolves.toEqual([cacheRecord, cacheRecord]);
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
		}
	);
});

describe('IndexedDbOfflineStoreAdapter errors', () => {
	it.each(['AbortError', 'QuotaExceededError', 'InvalidStateError'])(
		'does not retry a %s after a transaction starts',
		async (name) => {
			const adapter = createAdapter();
			await adapter.saveCachedResponse(cachedResponse());
			const get = vi.spyOn(Store.prototype, 'get').mockImplementationOnce(() => {
				throw new DOMException(name, name);
			});
			try {
				await expect(adapter.getCachedResponse(cachedResponse().key)).rejects.toMatchObject({
					name
				});
				expect(get).toHaveBeenCalledTimes(1);
			} finally {
				adapter.close();
			}
		}
	);

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

function closeNextConnection(): void {
	const transaction = Db.prototype.transaction;
	vi.spyOn(Db.prototype, 'transaction').mockImplementationOnce(function (
		this: IDBDatabase,
		...args
	) {
		this.close();
		return transaction.apply(this, args);
	});
}
