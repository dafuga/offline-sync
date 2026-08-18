import { describe, expect, it, vi } from 'vitest';
import { OfflineSyncEngineService } from '../../src/services/OfflineSyncEngineService';
import { createMemoryOfflineStore, operation } from '../helpers/memoryOfflineStore';

describe('OfflineSyncEngineService', () => {
	it('creates queued operations and reports updated statistics', async () => {
		const store = createMemoryOfflineStore();
		const onStats = vi.fn();
		const engine = createEngine(store, { onStats });

		const queued = await engine.enqueueOperation({
			url: 'https://example.com/api/items',
			method: 'POST',
			headers: {},
			body: '{}',
			createdAt: 5,
			occurredAt: 5
		});

		expect(queued).toMatchObject({ id: 'generated-id', status: 'pending', attempts: 0 });
		expect(onStats).toHaveBeenLastCalledWith({
			pendingCount: 1,
			failedCount: 0,
			lastSyncedAt: null
		});
	});

	it('flushes operations in creation order and records the sync time', async () => {
		const store = createMemoryOfflineStore();
		const order: string[] = [];
		for (const item of [
			operation({ id: 'later', createdAt: 2, url: 'https://example.com/api/later' }),
			operation({ id: 'first', url: 'https://example.com/api/first' })
		]) {
			store.operations.set(item.id, item);
		}
		const engine = createEngine(store, {
			fetch: vi.fn(async (input) => {
				order.push(String(input));
				return Response.json({ success: true });
			})
		});

		await engine.flushQueue();
		expect(order).toEqual(['https://example.com/api/first', 'https://example.com/api/later']);
		expect(store.operations.size).toBe(0);
		expect((await store.getStats()).lastSyncedAt).toBe(1_000);
	});
});

describe('OfflineSyncEngineService concurrency', () => {
	it('serializes concurrent replay callers', async () => {
		const store = createMemoryOfflineStore();
		let active = 0;
		let maxActive = 0;
		const fetch = vi.fn(async () => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			await Promise.resolve();
			active -= 1;
			return Response.json({ success: true });
		});
		const engine = createEngine(store, { fetch });

		await Promise.all([
			engine.replayQueuedOperation(operation({ id: 'one' })),
			engine.replayQueuedOperation(operation({ id: 'two' }))
		]);
		expect(maxActive).toBe(1);
	});
});

function createEngine(
	store: ReturnType<typeof createMemoryOfflineStore>,
	overrides: Partial<ConstructorParameters<typeof OfflineSyncEngineService>[0]> = {}
): OfflineSyncEngineService {
	return new OfflineSyncEngineService({
		store,
		isOnline: () => true,
		fetch: vi.fn().mockResolvedValue(Response.json({ success: true })),
		now: () => 1_000,
		createId: () => 'generated-id',
		...overrides
	});
}
