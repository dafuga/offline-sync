import type { IndexedDbConnectionAdapter } from './IndexedDbConnectionAdapter';
import type { OfflineOperation, SyncStats } from '../models/OfflineSync.types';
export interface IndexedDbQueueAdapterConfig {
    connection: IndexedDbConnectionAdapter;
    store: string;
    meta: string;
    now: () => number;
}
export declare class IndexedDbQueueAdapter {
    private readonly config;
    constructor(config: IndexedDbQueueAdapterConfig);
    list(): Promise<OfflineOperation[]>;
    pending(limit: number): Promise<OfflineOperation[]>;
    stats(): Promise<SyncStats>;
    retry(id: string): Promise<void>;
}
