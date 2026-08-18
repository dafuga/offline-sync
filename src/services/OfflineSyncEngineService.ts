import { ReplayOperationService } from './ReplayOperationService';
import type {
	OfflineOperation,
	OfflineFetch,
	OfflineOperationInput,
	OfflineStore,
	ReplayHeadersPolicy,
	ReplayResolutionPolicy,
	SyncStats
} from '../models/OfflineSync.types';

export interface OfflineSyncEngineServiceConfig {
	store: OfflineStore;
	isOnline: () => boolean;
	fetch?: OfflineFetch;
	now?: () => number;
	createId?: () => string;
	maxAttempts?: number;
	baseRetryMs?: number;
	maxRetryMs?: number;
	credentials?: RequestCredentials;
	flushIntervalMs?: number;
	applyReplayHeaders?: ReplayHeadersPolicy;
	shouldTreatAsResolved?: ReplayResolutionPolicy;
	onStats?: (stats: SyncStats) => void;
}

const EMPTY_STATS: SyncStats = { pendingCount: 0, failedCount: 0, lastSyncedAt: null };

export class OfflineSyncEngineService {
	stats: SyncStats = EMPTY_STATS;
	private readonly replay: ReplayOperationService;
	private readonly now: () => number;
	private readonly createId: () => string;
	private syncChain: Promise<void> = Promise.resolve();
	private flushTimer: ReturnType<typeof globalThis.setInterval> | null = null;

	constructor(private readonly config: OfflineSyncEngineServiceConfig) {
		this.now = config.now ?? Date.now;
		this.createId = config.createId ?? (() => globalThis.crypto.randomUUID());
		this.replay = new ReplayOperationService({
			store: config.store,
			fetch: config.fetch ?? globalThis.fetch,
			now: this.now,
			maxAttempts: config.maxAttempts ?? 5,
			baseRetryMs: config.baseRetryMs ?? 2_000,
			maxRetryMs: config.maxRetryMs ?? 60_000,
			credentials: config.credentials,
			applyReplayHeaders: config.applyReplayHeaders,
			shouldTreatAsResolved: config.shouldTreatAsResolved
		});
	}

	async start(): Promise<void> {
		await this.refreshStats();
		if (this.flushTimer) return;
		this.flushTimer = globalThis.setInterval(
			() => void this.flushWhenNeeded(),
			this.config.flushIntervalMs ?? 3_000
		);
	}

	stop(): void {
		if (this.flushTimer) globalThis.clearInterval(this.flushTimer);
		this.flushTimer = null;
	}

	async refreshStats(): Promise<SyncStats> {
		this.stats = await this.config.store.getStats();
		this.config.onStats?.(this.stats);
		return this.stats;
	}

	async enqueueOperation(input: OfflineOperationInput): Promise<OfflineOperation> {
		const operation: OfflineOperation = {
			...input,
			id: this.createId(),
			attempts: 0,
			nextRetryAt: this.now(),
			status: 'pending',
			lastError: null
		};
		await this.config.store.upsertOperation(operation);
		await this.refreshStats();
		return operation;
	}

	async flushQueue(): Promise<void> {
		if (!this.config.isOnline()) return;
		await this.runSerialized(async () => {
			const queue = await this.config.store.getPendingOperations(100);
			for (const operation of queue) {
				if (!this.config.isOnline()) break;
				await this.replay.run(operation);
			}
			await this.recordSync();
		});
	}

	replayQueuedOperation(operation: OfflineOperation): Promise<Response | null> {
		if (!this.config.isOnline()) return Promise.resolve(null);
		return this.runSerialized(async () => {
			const response = await this.replay.run(operation);
			await this.recordSync();
			return response;
		});
	}

	private runSerialized<T>(task: () => Promise<T>): Promise<T> {
		const result = this.syncChain.then(task, task);
		this.syncChain = result.then(
			() => undefined,
			() => undefined
		);
		return result;
	}

	private async recordSync(): Promise<void> {
		await this.config.store.setLastSyncedAt(this.now());
		await this.refreshStats();
	}

	private async flushWhenNeeded(): Promise<void> {
		if (this.config.isOnline() && this.stats.pendingCount > 0) await this.flushQueue();
	}
}
