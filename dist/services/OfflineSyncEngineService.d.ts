import type { OfflineOperation, OfflineFetch, OfflineOperationInput, OfflineStore, ReplayHeadersPolicy, ReplayResolutionPolicy, SyncStats, ReplayHooks, CachedResponseRecord } from '../models/OfflineSync.types';
export interface OfflineSyncEngineServiceConfig extends ReplayHooks {
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
    onError?: (error: unknown) => void;
}
export declare class OfflineSyncEngineService {
    private readonly config;
    stats: SyncStats;
    private readonly replay;
    private readonly now;
    private readonly createId;
    private syncChain;
    private flushTimer;
    constructor(config: OfflineSyncEngineServiceConfig);
    start(): Promise<void>;
    stop(): void;
    refreshStats(): Promise<SyncStats>;
    enqueueOperation(input: OfflineOperationInput, cache?: CachedResponseRecord[]): Promise<OfflineOperation>;
    flushQueue(): Promise<void>;
    replayQueuedOperation(operation: OfflineOperation): Promise<Response | null>;
    private runSerialized;
    private flushWhenNeeded;
}
