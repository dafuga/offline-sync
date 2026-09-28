import type { OfflineOperation, OfflineFetch, OfflineStore, ReplayHeadersPolicy, ReplayResolutionPolicy, ReplayHooks } from '../models/OfflineSync.types';
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
export declare class ReplayOperationService {
    private readonly config;
    constructor(config: ReplayOperationServiceConfig);
    run(operation: OfflineOperation): Promise<Response | null>;
    private handleResponse;
    private send;
    private decision;
    private retry;
}
