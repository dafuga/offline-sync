import type {
	OfflineOperation,
	OfflineFetch,
	OfflineStore,
	ReplayHeadersPolicy,
	ReplayResolutionPolicy
} from '../models/OfflineSync.types';

export interface ReplayOperationServiceConfig {
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
		const syncingOperation: OfflineOperation = { ...operation, status: 'syncing' };
		await this.config.store.upsertOperation(syncingOperation);

		try {
			const response = await this.send(syncingOperation);
			const responseText = await response
				.clone()
				.text()
				.catch(() => '');
			const resolved =
				response.ok || (await this.isPolicyResolved(syncingOperation, response, responseText));

			if (resolved) await this.config.store.deleteOperation(syncingOperation.id);
			else await this.retry(syncingOperation, `HTTP ${response.status}`);
			return response;
		} catch (error) {
			await this.retry(syncingOperation, errorMessage(error));
			return null;
		}
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

	private isPolicyResolved(
		operation: OfflineOperation,
		response: Response,
		responseText: string
	): boolean | Promise<boolean> {
		return this.config.shouldTreatAsResolved?.({ operation, response, responseText }) ?? false;
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
