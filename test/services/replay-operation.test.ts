import { describe, expect, it, vi } from 'vitest';
import { ReplayOperationService } from '../../src/services/ReplayOperationService';
import type { OfflineFetch } from '../../src/models/OfflineSync.types';
import { createMemoryOfflineStore, operation } from '../helpers/memoryOfflineStore';

describe('ReplayOperationService', () => {
	it('applies replay headers and removes a successful operation', async () => {
		const store = createMemoryOfflineStore();
		const queued = operation();
		store.operations.set(queued.id, queued);
		const fetch = vi.fn().mockResolvedValue(Response.json({ success: true }));
		const replay = createReplay(store, fetch, {
			applyReplayHeaders: (headers) => headers.set('X-Replayed', '1')
		});

		await expect(replay.run(queued)).resolves.toMatchObject({ ok: true });
		expect(store.operations.size).toBe(0);
		expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('X-Replayed')).toBe('1');
	});

	it('retries with exponential backoff and eventually marks failures', async () => {
		const store = createMemoryOfflineStore();
		const fetch = vi.fn().mockRejectedValue(new Error('offline'));
		const replay = createReplay(store, fetch, { maxAttempts: 2 });
		const queued = operation();

		await replay.run(queued);
		expect(store.operations.get(queued.id)).toMatchObject({
			attempts: 1,
			status: 'pending',
			nextRetryAt: 1_200,
			lastError: 'offline'
		});

		await replay.run(store.operations.get(queued.id)!);
		expect(store.operations.get(queued.id)).toMatchObject({ attempts: 2, status: 'failed' });
	});

	it('lets application policy resolve idempotent API responses', async () => {
		const store = createMemoryOfflineStore();
		const queued = operation();
		store.operations.set(queued.id, queued);
		const replay = createReplay(
			store,
			vi.fn().mockResolvedValue(new Response('already applied', { status: 409 })),
			{ shouldTreatAsResolved: ({ response }) => response.status === 409 }
		);

		await replay.run(queued);
		expect(store.operations.size).toBe(0);
	});
});

function createReplay(
	store: ReturnType<typeof createMemoryOfflineStore>,
	fetch: OfflineFetch,
	overrides: Partial<ConstructorParameters<typeof ReplayOperationService>[0]> = {}
): ReplayOperationService {
	return new ReplayOperationService({
		store,
		fetch,
		now: () => 1_000,
		maxAttempts: 5,
		baseRetryMs: 100,
		maxRetryMs: 1_000,
		...overrides
	});
}
