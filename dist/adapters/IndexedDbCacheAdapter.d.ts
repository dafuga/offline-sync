import type { IndexedDbConnectionAdapter } from './IndexedDbConnectionAdapter';
import type { CachedResponseRecord } from '../models/OfflineSync.types';
export interface IndexedDbCacheAdapterConfig {
    connection: IndexedDbConnectionAdapter;
    store: string;
}
export declare class IndexedDbCacheAdapter {
    private readonly config;
    constructor(config: IndexedDbCacheAdapterConfig);
    list(prefix?: string): Promise<CachedResponseRecord[]>;
    remove(keys: readonly string[]): Promise<void>;
}
