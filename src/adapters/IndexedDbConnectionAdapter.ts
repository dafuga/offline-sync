export interface IndexedDbConnectionConfig {
	databaseName: string;
	version: number;
	stores: IndexedDbStoreNames;
	obsoleteStoreNames: readonly string[];
	openRetryCooldownMs: number;
	openTimeoutMs?: number;
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
		try {
			const [result] = await Promise.all([
				requestToPromise(createRequest(transaction.objectStore(storeName))),
				completion
			]);
			return result;
		} catch (failure) {
			try {
				transaction.abort();
			} catch {
				/* Transaction already settled. */
			}
			await completion.catch(() => undefined);
			throw failure;
		}
	}

	close(): void {
		void this.dbPromise?.then((database) => database.close()).catch(() => undefined);
		this.dbPromise = null;
	}

	async writeBatch(
		changes: readonly { store: string; put?: unknown; remove?: IDBValidKey }[]
	): Promise<void> {
		const db = await this.open();
		const transaction = db.transaction(
			[...new Set(changes.map((change) => change.store))],
			'readwrite'
		);
		const completion = transactionToPromise(transaction);
		try {
			for (const change of changes) {
				const store = transaction.objectStore(change.store);
				if (change.remove !== undefined) store.delete(change.remove);
				else store.put(change.put);
			}
		} catch (error) {
			transaction.abort();
			await completion.catch(() => undefined);
			throw error;
		}
		await completion;
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
		return openDatabase(factory, this.config, {
			onError: (reject) => this.handleOpenError(reject),
			onSuccess: (database, resolve) => this.handleOpenSuccess(database, resolve),
			onUpgrade: (database, transaction) => this.upgrade(database, transaction)
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

function openDatabase(
	factory: IDBFactory,
	config: IndexedDbConnectionConfig,
	handlers: {
		onError: (reject: (error: Error) => void) => void;
		onSuccess: (database: IDBDatabase, resolve: (database: IDBDatabase) => void) => void;
		onUpgrade: (database: IDBDatabase, transaction: IDBTransaction | null) => void;
	}
): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const fail = () => {
			if (settled) return;
			settled = true;
			globalThis.clearTimeout(timer);
			handlers.onError(reject);
		};
		const timer = globalThis.setTimeout(fail, config.openTimeoutMs ?? 3000);
		try {
			const request = factory.open(config.databaseName, config.version);
			request.onerror = fail;
			request.onsuccess = () => {
				if (settled) {
					request.result.close();
					return;
				}
				settled = true;
				globalThis.clearTimeout(timer);
				handlers.onSuccess(request.result, resolve);
			};
			request.onupgradeneeded = () => {
				if (settled) {
					request.transaction?.abort();
					return;
				}
				handlers.onUpgrade(request.result, request.transaction);
			};
		} catch {
			fail();
		}
	});
}
