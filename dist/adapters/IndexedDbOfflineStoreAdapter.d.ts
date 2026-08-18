import { type IndexedDbStoreNames } from './IndexedDbConnectionAdapter';
import type { CachedResponseRecord, OfflineOperation, OfflineStore, SyncStats } from '../models/OfflineSync.types';
export interface IndexedDbOfflineStoreAdapterConfig {
    databaseName: string;
    version?: number;
    stores?: Partial<IndexedDbStoreNames>;
    obsoleteStoreNames?: readonly string[];
    openRetryCooldownMs?: number;
    indexedDb?: IDBFactory;
    now?: () => number;
}
export declare class IndexedDbOfflineStoreAdapter implements OfflineStore {
    private readonly connection;
    private readonly stores;
    private readonly now;
    constructor(config: IndexedDbOfflineStoreAdapterConfig);
    isAvailable(): boolean;
    saveCachedResponse(record: CachedResponseRecord): Promise<void>;
    getCachedResponse(key: string): Promise<CachedResponseRecord | null>;
    upsertOperation(operation: OfflineOperation): Promise<void>;
    deleteOperation(id: string): Promise<void>;
    getPendingOperations(limit?: number): Promise<OfflineOperation[]>;
    getStats(): Promise<SyncStats>;
    setLastSyncedAt(timestamp: number): Promise<void>;
    close(): void;
    private write;
    private getAllOperations;
    private getLastSyncedAt;
}
