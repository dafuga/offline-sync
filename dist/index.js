// src/adapters/IndexedDbConnectionAdapter.ts
class IndexedDbConnectionAdapter {
  config;
  dbPromise = null;
  openRetryAfterMs = 0;
  constructor(config) {
    this.config = config;
  }
  isAvailable() {
    return Boolean(this.factory) && this.config.now() >= this.openRetryAfterMs;
  }
  async request(storeName, mode, createRequest) {
    const db = await this.open();
    const transaction = db.transaction([storeName], mode);
    const completion = transactionToPromise(transaction);
    const result = await requestToPromise(createRequest(transaction.objectStore(storeName)));
    await completion;
    return result;
  }
  close() {
    this.dbPromise?.then((database) => database.close());
    this.dbPromise = null;
  }
  get factory() {
    return this.config.indexedDb ?? globalThis.indexedDB;
  }
  open() {
    if (this.dbPromise)
      return this.dbPromise;
    if (!this.isAvailable() || !this.factory) {
      return Promise.reject(new Error("Offline database is temporarily unavailable"));
    }
    this.dbPromise = this.createOpenRequest(this.factory);
    return this.dbPromise;
  }
  createOpenRequest(factory) {
    return new Promise((resolve, reject) => {
      const request = factory.open(this.config.databaseName, this.config.version);
      request.onerror = () => this.handleOpenError(reject);
      request.onsuccess = () => this.handleOpenSuccess(request.result, resolve);
      request.onupgradeneeded = () => this.upgrade(request.result, request.transaction);
    });
  }
  handleOpenError(reject) {
    this.dbPromise = null;
    this.openRetryAfterMs = this.config.now() + this.config.openRetryCooldownMs;
    reject(new Error("Failed to open offline database"));
  }
  handleOpenSuccess(database, resolve) {
    this.openRetryAfterMs = 0;
    database.onversionchange = () => this.close();
    resolve(database);
  }
  upgrade(database, transaction) {
    createStore(database, transaction, this.config.stores.cache, "key");
    const queue = createStore(database, transaction, this.config.stores.queue, "id");
    createIndex(queue, "status");
    createIndex(queue, "nextRetryAt");
    createIndex(queue, "createdAt");
    createStore(database, transaction, this.config.stores.meta, "key");
    this.deleteObsoleteStores(database);
  }
  deleteObsoleteStores(database) {
    for (const storeName of this.config.obsoleteStoreNames) {
      if (database.objectStoreNames.contains(storeName))
        database.deleteObjectStore(storeName);
    }
  }
}
function createStore(database, transaction, name, keyPath) {
  if (database.objectStoreNames.contains(name)) {
    if (!transaction)
      throw new Error(`Missing upgrade transaction for ${name}`);
    return transaction.objectStore(name);
  }
  return database.createObjectStore(name, { keyPath });
}
function createIndex(store, name) {
  if (!store.indexNames.contains(name))
    store.createIndex(name, name, { unique: false });
}
function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}
function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(new Error("IndexedDB transaction aborted"));
  });
}

// src/adapters/IndexedDbOfflineStoreAdapter.ts
var DEFAULT_STORES = {
  cache: "cache",
  queue: "sync_queue",
  meta: "sync_meta"
};

class IndexedDbOfflineStoreAdapter {
  connection;
  stores;
  now;
  constructor(config) {
    this.stores = { ...DEFAULT_STORES, ...config.stores };
    this.now = config.now ?? Date.now;
    this.connection = new IndexedDbConnectionAdapter({
      databaseName: config.databaseName,
      version: config.version ?? 1,
      stores: this.stores,
      obsoleteStoreNames: config.obsoleteStoreNames ?? [],
      openRetryCooldownMs: config.openRetryCooldownMs ?? 60000,
      indexedDb: config.indexedDb,
      now: this.now
    });
  }
  isAvailable() {
    return this.connection.isAvailable();
  }
  saveCachedResponse(record) {
    return this.write(this.stores.cache, record);
  }
  async getCachedResponse(key) {
    if (!this.isAvailable())
      return null;
    const result = await this.connection.request(this.stores.cache, "readonly", (store) => store.get(key));
    return result ?? null;
  }
  upsertOperation(operation) {
    return this.write(this.stores.queue, operation);
  }
  async deleteOperation(id) {
    if (!this.isAvailable())
      return;
    await this.connection.request(this.stores.queue, "readwrite", (store) => store.delete(id));
  }
  async getPendingOperations(limit = 50) {
    if (!this.isAvailable())
      return [];
    const operations = await this.getAllOperations();
    return operations.filter((operation) => operation.status !== "failed" && operation.nextRetryAt <= this.now()).sort((left, right) => left.createdAt - right.createdAt).slice(0, limit);
  }
  async getStats() {
    if (!this.isAvailable())
      return emptyStats();
    const operations = await this.getAllOperations();
    const lastSyncedAt = await this.getLastSyncedAt();
    return {
      pendingCount: operations.filter((item) => item.status !== "failed").length,
      failedCount: operations.filter((item) => item.status === "failed").length,
      lastSyncedAt
    };
  }
  setLastSyncedAt(timestamp) {
    return this.write(this.stores.meta, { key: "lastSyncedAt", value: timestamp });
  }
  close() {
    this.connection.close();
  }
  async write(storeName, value) {
    if (!this.isAvailable())
      return;
    await this.connection.request(storeName, "readwrite", (store) => store.put(value));
  }
  getAllOperations() {
    return this.connection.request(this.stores.queue, "readonly", (store) => store.getAll());
  }
  async getLastSyncedAt() {
    const result = await this.connection.request(this.stores.meta, "readonly", (store) => store.get("lastSyncedAt"));
    return result?.value ?? null;
  }
}
function emptyStats() {
  return { pendingCount: 0, failedCount: 0, lastSyncedAt: null };
}
// src/services/ReplayOperationService.ts
class ReplayOperationService {
  config;
  constructor(config) {
    this.config = config;
  }
  async run(operation) {
    const syncingOperation = { ...operation, status: "syncing" };
    await this.config.store.upsertOperation(syncingOperation);
    try {
      const response = await this.send(syncingOperation);
      const responseText = await response.clone().text().catch(() => "");
      const resolved = response.ok || await this.isPolicyResolved(syncingOperation, response, responseText);
      if (resolved)
        await this.config.store.deleteOperation(syncingOperation.id);
      else
        await this.retry(syncingOperation, `HTTP ${response.status}`);
      return response;
    } catch (error) {
      await this.retry(syncingOperation, errorMessage(error));
      return null;
    }
  }
  async send(operation) {
    const headers = new Headers(operation.headers);
    await this.config.applyReplayHeaders?.(headers, operation);
    return this.config.fetch(operation.url, {
      method: operation.method,
      headers,
      body: operation.body,
      credentials: this.config.credentials
    });
  }
  isPolicyResolved(operation, response, responseText) {
    return this.config.shouldTreatAsResolved?.({ operation, response, responseText }) ?? false;
  }
  retry(operation, message) {
    const attempts = operation.attempts + 1;
    const delay = Math.min(this.config.baseRetryMs * Math.pow(2, attempts), this.config.maxRetryMs);
    return this.config.store.upsertOperation({
      ...operation,
      attempts,
      status: attempts >= this.config.maxAttempts ? "failed" : "pending",
      lastError: message,
      nextRetryAt: this.config.now() + delay
    });
  }
}
function errorMessage(error) {
  return error instanceof Error ? error.message : "Network error";
}

// src/services/OfflineSyncEngineService.ts
var EMPTY_STATS = { pendingCount: 0, failedCount: 0, lastSyncedAt: null };

class OfflineSyncEngineService {
  config;
  stats = EMPTY_STATS;
  replay;
  now;
  createId;
  syncChain = Promise.resolve();
  flushTimer = null;
  constructor(config) {
    this.config = config;
    this.now = config.now ?? Date.now;
    this.createId = config.createId ?? (() => globalThis.crypto.randomUUID());
    this.replay = new ReplayOperationService({
      store: config.store,
      fetch: config.fetch ?? globalThis.fetch,
      now: this.now,
      maxAttempts: config.maxAttempts ?? 5,
      baseRetryMs: config.baseRetryMs ?? 2000,
      maxRetryMs: config.maxRetryMs ?? 60000,
      credentials: config.credentials,
      applyReplayHeaders: config.applyReplayHeaders,
      shouldTreatAsResolved: config.shouldTreatAsResolved
    });
  }
  async start() {
    await this.refreshStats();
    if (this.flushTimer)
      return;
    this.flushTimer = globalThis.setInterval(() => void this.flushWhenNeeded(), this.config.flushIntervalMs ?? 3000);
  }
  stop() {
    if (this.flushTimer)
      globalThis.clearInterval(this.flushTimer);
    this.flushTimer = null;
  }
  async refreshStats() {
    this.stats = await this.config.store.getStats();
    this.config.onStats?.(this.stats);
    return this.stats;
  }
  async enqueueOperation(input) {
    const operation = {
      ...input,
      id: this.createId(),
      attempts: 0,
      nextRetryAt: this.now(),
      status: "pending",
      lastError: null
    };
    await this.config.store.upsertOperation(operation);
    await this.refreshStats();
    return operation;
  }
  async flushQueue() {
    if (!this.config.isOnline())
      return;
    await this.runSerialized(async () => {
      const queue = await this.config.store.getPendingOperations(100);
      for (const operation of queue) {
        if (!this.config.isOnline())
          break;
        await this.replay.run(operation);
      }
      await this.recordSync();
    });
  }
  replayQueuedOperation(operation) {
    if (!this.config.isOnline())
      return Promise.resolve(null);
    return this.runSerialized(async () => {
      const response = await this.replay.run(operation);
      await this.recordSync();
      return response;
    });
  }
  runSerialized(task) {
    const result = this.syncChain.then(task, task);
    this.syncChain = result.then(() => {
      return;
    }, () => {
      return;
    });
    return result;
  }
  async recordSync() {
    await this.config.store.setLastSyncedAt(this.now());
    await this.refreshStats();
  }
  async flushWhenNeeded() {
    if (this.config.isOnline() && this.stats.pendingCount > 0)
      await this.flushQueue();
  }
}
// src/utils/reconcileVersionedDataset.ts
function reconcileVersionedDataset(currentItems, incomingItems, options = {}) {
  const deletedKeys = new Set(options.deletedKeys ?? []);
  const incomingByKey = new Map(incomingItems.map((item) => [item.syncKey, item]));
  const items = [];
  const updatedItems = [];
  const unchangedItems = [];
  const removedItems = [];
  for (const currentItem of currentItems) {
    if (deletedKeys.has(currentItem.syncKey)) {
      removedItems.push(currentItem);
      incomingByKey.delete(currentItem.syncKey);
      continue;
    }
    const incomingItem = incomingByKey.get(currentItem.syncKey);
    incomingByKey.delete(currentItem.syncKey);
    if (!incomingItem || incomingItem.contentRevision === currentItem.contentRevision) {
      items.push(currentItem);
      unchangedItems.push(currentItem);
      continue;
    }
    items.push(incomingItem);
    updatedItems.push(incomingItem);
  }
  const addedItems = [...incomingByKey.values()].filter((item) => !deletedKeys.has(item.syncKey));
  items.push(...addedItems);
  return { items, addedItems, updatedItems, unchangedItems, removedItems };
}

// src/index.ts
function buildCacheKey(url) {
  return `GET:${url}`;
}
export {
  reconcileVersionedDataset,
  buildCacheKey,
  ReplayOperationService,
  OfflineSyncEngineService,
  IndexedDbOfflineStoreAdapter
};
