import type {
	OfflineOperation,
	OfflineFetch,
	OfflineStore,
	ReplayHeadersPolicy,
	ReplayResolutionPolicy,
	ReplayHooks,
	ReplayResolutionContext,
	ReplayDecision
} from '../models/OfflineSync.types';

export interface ReplayOperationServiceConfig extends ReplayHooks {
	store: OfflineStore;
	fetch: OfflineFetch;
	now: () => number;
	maxAttempts: number;
	baseRetryMs: number;
	maxRetryMs: number;
	credentials?: RequestCredentials;
	applyReplayHeaders?: ReplayHeadersPolicy;
	shouldTreatAsResolved?: ReplayResolutionPolicy;
}

export class ReplayOperationService {
	constructor(private readonly config: ReplayOperationServiceConfig) {}

	async run(operation: OfflineOperation): Promise<Response | null> {
		if (this.config.canReplay && !(await this.config.canReplay(operation))) return null;
		const syncingOperation: OfflineOperation = { ...operation, status: 'syncing' };
		await this.config.store.upsertOperation(syncingOperation);

		try {
			const response = await this.send(syncingOperation);
			const responseText = await response
				.clone()
				.text()
				.catch(() => '');
			await this.handleResponse({ operation: syncingOperation, response, responseText });
			return response;
		} catch (error) {
			await this.retry(syncingOperation, errorMessage(error));
			return null;
		}
	}

	private async handleResponse(context: ReplayResolutionContext): Promise<void> {
		const { operation, response } = context;
		const decision = await this.decision(context);
		const resolved = decision.status === 'resolved';
		if (resolved) {
			await this.config.onResolved?.(context);
			await this.config.store.deleteOperation(operation.id);
			await this.config.store.setLastSyncedAt(this.config.now());
		} else if (decision.status === 'blocked' || decision.status === 'failed') {
			await this.config.store.upsertOperation({
				...operation,
				status: decision.status,
				lastError: decision.reason ?? `HTTP ${response.status}`
			});
		} else await this.retry(operation, decision.reason ?? `HTTP ${response.status}`);
	}

	private async send(operation: OfflineOperation): Promise<Response> {
		const headers = new Headers(operation.headers);
		await this.config.applyReplayHeaders?.(headers, operation);
		return this.config.fetch(operation.url, {
			method: operation.method,
			headers,
			body: operation.body,
			credentials: this.config.credentials
		});
	}

	private async decision(context: ReplayResolutionContext): Promise<ReplayDecision> {
		if (this.config.classifyResponse) return this.config.classifyResponse(context);
		const resolved = context.response.ok || (await this.config.shouldTreatAsResolved?.(context));
		return { status: resolved ? 'resolved' : 'retry' };
	}

	private retry(operation: OfflineOperation, message: string): Promise<void> {
		const attempts = operation.attempts + 1;
		const delay = Math.min(this.config.baseRetryMs * Math.pow(2, attempts), this.config.maxRetryMs);

		return this.config.store.upsertOperation({
			...operation,
			attempts,
			status: attempts >= this.config.maxAttempts ? 'failed' : 'pending',
			lastError: message,
			nextRetryAt: this.config.now() + delay
		});
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Network error';
}
