export type OfflineOperationStatus = 'pending' | 'syncing' | 'failed' | 'blocked';

export type OfflineMutationMethod = 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type OfflineFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface CachedResponseRecord {
	key: string;
	url: string;
	status: number;
	statusText: string;
	headers: Record<string, string>;
	body: string;
	updatedAt: number;
}

export interface OfflineOperationInput {
	url: string;
	method: OfflineMutationMethod;
	headers: Record<string, string>;
	body: string | null;
	createdAt: number;
	occurredAt: number;
}

export interface OfflineOperation extends OfflineOperationInput {
	id: string;
	attempts: number;
	nextRetryAt: number;
	status: OfflineOperationStatus;
	lastError: string | null;
}

export interface SyncStats {
	pendingCount: number;
	failedCount: number;
	lastSyncedAt: number | null;
}

export interface OfflineStore {
	isAvailable(): boolean;
	saveCachedResponse(record: CachedResponseRecord): Promise<void>;
	getCachedResponse(key: string): Promise<CachedResponseRecord | null>;
	upsertOperation(operation: OfflineOperation): Promise<void>;
	deleteOperation(
		id: string,
		cache?: CachedResponseRecord[],
		removeCacheKeys?: readonly string[]
	): Promise<void>;
	getPendingOperations(limit?: number): Promise<OfflineOperation[]>;
	getStats(): Promise<SyncStats>;
	setLastSyncedAt(timestamp: number): Promise<void>;
	commitOperation?(
		operation: OfflineOperation,
		cache: CachedResponseRecord[],
		removeCacheKeys?: readonly string[]
	): Promise<void>;
}

export interface ReplayDecision {
	status: 'resolved' | 'retry' | 'blocked' | 'failed';
	reason?: string;
}

export interface ReplayHooks {
	canReplay?: (operation: OfflineOperation) => boolean | Promise<boolean>;
	classifyResponse?: (context: ReplayResolutionContext) => ReplayDecision | Promise<ReplayDecision>;
	onResolved?: (context: ReplayResolutionContext) => void | Promise<void>;
}

export interface ReplayResolutionContext {
	operation: OfflineOperation;
	response: Response;
	responseText: string;
}

export type ReplayHeadersPolicy = (
	headers: Headers,
	operation: OfflineOperation
) => void | Promise<void>;

export type ReplayResolutionPolicy = (
	context: ReplayResolutionContext
) => boolean | Promise<boolean>;
