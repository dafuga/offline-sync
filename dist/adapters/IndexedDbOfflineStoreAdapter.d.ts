import { type IndexedDbStoreNames } from './IndexedDbConnectionAdapter';
import type { CachedResponseRecord, OfflineOperation, OfflineStore, SyncStats } from '../models/OfflineSync.types';
export interface IndexedDbOfflineStoreAdapterConfig {
    databaseName: string;
    version?: number;
    stores?: Partial<IndexedDbStoreNames>;
    obsoleteStoreNames?: readonly string[];
    openRetryCooldownMs?: number;
    openTimeoutMs?: number;
    indexedDb?: IDBFactory;
    now?: () => number;
}
export declare class IndexedDbOfflineStoreAdapter implements OfflineStore {
    private readonly connection;
    private readonly stores;
    private readonly now;
    private readonly queue;
    private readonly cache;
    constructor(config: IndexedDbOfflineStoreAdapterConfig);
    isAvailable(): boolean;
    saveCachedResponse(record: CachedResponseRecord): Promise<void>;
    getCachedResponse(key: string): Promise<CachedResponseRecord | null>;
    upsertOperation(operation: OfflineOperation): Promise<void>;
    deleteOperation(id: string, cache?: CachedResponseRecord[], removeCacheKeys?: readonly string[]): Promise<void>;
    getPendingOperations(limit?: number): Promise<OfflineOperation[]>;
    getStats(): Promise<SyncStats>;
    setLastSyncedAt(timestamp: number): Promise<void>;
    listOperations(): Promise<OfflineOperation[]>;
    retryOperation(id: string): Promise<void>;
    listCachedResponses(prefix?: string): Promise<CachedResponseRecord[]>;
    deleteCachedResponses(keys: readonly string[]): Promise<void>;
    commitOperation(operation: OfflineOperation, cache: CachedResponseRecord[], removeCacheKeys?: readonly string[]): Promise<void>;
    commitOperations(operations: readonly OfflineOperation[], cache: readonly CachedResponseRecord[], removeCacheKeys?: readonly string[]): Promise<void>;
    close(): void;
    private write;
}
