export interface IndexedDbConnectionConfig {
    databaseName: string;
    version: number;
    stores: IndexedDbStoreNames;
    obsoleteStoreNames: readonly string[];
    openRetryCooldownMs: number;
    indexedDb?: IDBFactory;
    now: () => number;
}
export interface IndexedDbStoreNames {
    cache: string;
    queue: string;
    meta: string;
}
export declare class IndexedDbConnectionAdapter {
    private readonly config;
    private dbPromise;
    private openRetryAfterMs;
    constructor(config: IndexedDbConnectionConfig);
    isAvailable(): boolean;
    request<T>(storeName: string, mode: IDBTransactionMode, createRequest: (store: IDBObjectStore) => IDBRequest<T>): Promise<T>;
    close(): void;
    writeBatch(changes: readonly {
        store: string;
        put?: unknown;
        remove?: IDBValidKey;
    }[]): Promise<void>;
    private get factory();
    private open;
    private createOpenRequest;
    private handleOpenError;
    private handleOpenSuccess;
    private upgrade;
    private deleteObsoleteStores;
}
