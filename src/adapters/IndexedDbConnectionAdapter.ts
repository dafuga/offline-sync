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

export class IndexedDbConnectionAdapter {
	private dbPromise: Promise<IDBDatabase> | null = null;
	private openRetryAfterMs = 0;

	constructor(private readonly config: IndexedDbConnectionConfig) {}

	isAvailable(): boolean {
		return Boolean(this.factory) && this.config.now() >= this.openRetryAfterMs;
	}

	async request<T>(
		storeName: string,
		mode: IDBTransactionMode,
		createRequest: (store: IDBObjectStore) => IDBRequest<T>
	): Promise<T> {
		const db = await this.open();
		const transaction = db.transaction([storeName], mode);
		const completion = transactionToPromise(transaction);
		const result = await requestToPromise(createRequest(transaction.objectStore(storeName)));
		await completion;
		return result;
	}

	close(): void {
		void this.dbPromise?.then((database) => database.close());
		this.dbPromise = null;
	}

	private get factory(): IDBFactory | undefined {
		return this.config.indexedDb ?? globalThis.indexedDB;
	}

	private open(): Promise<IDBDatabase> {
		if (this.dbPromise) return this.dbPromise;
		if (!this.isAvailable() || !this.factory) {
			return Promise.reject(new Error('Offline database is temporarily unavailable'));
		}

		this.dbPromise = this.createOpenRequest(this.factory);
		return this.dbPromise;
	}

	private createOpenRequest(factory: IDBFactory): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const request = factory.open(this.config.databaseName, this.config.version);
			request.onerror = () => this.handleOpenError(reject);
			request.onsuccess = () => this.handleOpenSuccess(request.result, resolve);
			request.onupgradeneeded = () => this.upgrade(request.result, request.transaction);
		});
	}

	private handleOpenError(reject: (error: Error) => void): void {
		this.dbPromise = null;
		this.openRetryAfterMs = this.config.now() + this.config.openRetryCooldownMs;
		reject(new Error('Failed to open offline database'));
	}

	private handleOpenSuccess(database: IDBDatabase, resolve: (database: IDBDatabase) => void): void {
		this.openRetryAfterMs = 0;
		database.onversionchange = () => this.close();
		resolve(database);
	}

	private upgrade(database: IDBDatabase, transaction: IDBTransaction | null): void {
		createStore(database, transaction, this.config.stores.cache, 'key');
		const queue = createStore(database, transaction, this.config.stores.queue, 'id');
		createIndex(queue, 'status');
		createIndex(queue, 'nextRetryAt');
		createIndex(queue, 'createdAt');
		createStore(database, transaction, this.config.stores.meta, 'key');
		this.deleteObsoleteStores(database);
	}

	private deleteObsoleteStores(database: IDBDatabase): void {
		for (const storeName of this.config.obsoleteStoreNames) {
			if (database.objectStoreNames.contains(storeName)) database.deleteObjectStore(storeName);
		}
	}
}

function createStore(
	database: IDBDatabase,
	transaction: IDBTransaction | null,
	name: string,
	keyPath: string
): IDBObjectStore {
	if (database.objectStoreNames.contains(name)) {
		if (!transaction) throw new Error(`Missing upgrade transaction for ${name}`);
		return transaction.objectStore(name);
	}
	return database.createObjectStore(name, { keyPath });
}

function createIndex(store: IDBObjectStore, name: string): void {
	if (!store.indexNames.contains(name)) store.createIndex(name, name, { unique: false });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
	});
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () =>
			reject(transaction.error ?? new Error('IndexedDB transaction failed'));
		transaction.onabort = () => reject(new Error('IndexedDB transaction aborted'));
	});
}
