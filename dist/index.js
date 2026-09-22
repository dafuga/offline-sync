// src/adapters/IndexedDbQueueAdapter.ts
class IndexedDbQueueAdapter {
  config;
  constructor(config) {
    this.config = config;
  }
  list() {
    return this.config.connection.request(this.config.store, "readonly", (store) => store.getAll());
  }
  async pending(limit) {
    return (await this.list()).filter((operation) => ["pending", "syncing"].includes(operation.status) && operation.nextRetryAt <= this.config.now()).sort((left, right) => left.createdAt - right.createdAt).slice(0, limit);
  }
  async stats() {
    const operations = await this.list();
    const last = await this.config.connection.request(this.config.meta, "readonly", (store) => store.get("lastSyncedAt"));
    return {
      pendingCount: operations.filter((item) => ["pending", "syncing"].includes(item.status)).length,
      failedCount: operations.filter((item) => ["failed", "blocked"].includes(item.status)).length,
      lastSyncedAt: last?.value ?? null
    };
  }
  async retry(id) {
    const current = await this.config.connection.request(this.config.store, "readonly", (store) => store.get(id));
    if (!current)
      throw new Error("Offline operation not found");
    if (current.status === "syncing")
      throw new Error("Cannot retry an active operation");
    await this.config.connection.request(this.config.store, "readwrite", (store) => store.put({
      ...current,
      status: "pending",
      attempts: 0,
      nextRetryAt: this.config.now(),
      lastError: null
    }));
  }
}

// src/adapters/IndexedDbCacheAdapter.ts
class IndexedDbCacheAdapter {
  config;
  constructor(config) {
    this.config = config;
  }
  async list(prefix = "") {
    const records = await this.config.connection.request(this.config.store, "readonly", (store) => store.getAll());
    return records.filter((record) => record.key.startsWith(prefix));
  }
  async remove(keys) {
    if (!keys.length)
      return;
    await this.config.connection.writeBatch(keys.map((key) => ({ store: this.config.store, remove: key })));
  }
}

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
    try {
      const [result] = await Promise.all([
        requestToPromise(createRequest(transaction.objectStore(storeName))),
        completion
      ]);
      return result;
    } catch (failure) {
      try {
        transaction.abort();
      } catch {}
      await completion.catch(() => {
        return;
      });
      throw failure;
    }
  }
  close() {
    this.dbPromise?.then((database) => database.close()).catch(() => {
      return;
    });
    this.dbPromise = null;
  }
  async writeBatch(changes) {
    const db = await this.open();
    const transaction = db.transaction([...new Set(changes.map((change) => change.store))], "readwrite");
    const completion = transactionToPromise(transaction);
    try {
      for (const change of changes) {
        const store = transaction.objectStore(change.store);
        if (change.remove !== undefined)
          store.delete(change.remove);
        else
          store.put(change.put);
      }
    } catch (error) {
      transaction.abort();
      await completion.catch(() => {
        return;
      });
      throw error;
    }
    await completion;
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
    return openDatabase(factory, this.config, {
      onError: (reject) => this.handleOpenError(reject),
      onSuccess: (database, resolve) => this.handleOpenSuccess(database, resolve),
      onUpgrade: (database, transaction) => this.upgrade(database, transaction)
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
function openDatabase(factory, config, handlers) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = () => {
      if (settled)
        return;
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
  queue;
  cache;
  constructor(config) {
    this.stores = { ...DEFAULT_STORES, ...config.stores };
    this.now = config.now ?? Date.now;
    this.connection = createConnection(config, this.stores, this.now);
    this.queue = new IndexedDbQueueAdapter({
      connection: this.connection,
      store: this.stores.queue,
      meta: this.stores.meta,
      now: this.now
    });
    this.cache = new IndexedDbCacheAdapter({
      connection: this.connection,
      store: this.stores.cache
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
  async upsertOperation(operation) {
    if (!this.isAvailable())
      throw new Error("Offline storage unavailable");
    return this.write(this.stores.queue, operation);
  }
  async deleteOperation(id, cache = [], removeCacheKeys = []) {
    if (!this.isAvailable())
      throw new Error("Offline storage unavailable");
    await commitStoreChanges(this.connection, this.stores, {
      operations: [],
      cache,
      removeCacheKeys,
      removeOperations: [id]
    });
  }
  async getPendingOperations(limit = 50) {
    if (!this.isAvailable())
      return [];
    return this.queue.pending(limit);
  }
  async getStats() {
    if (!this.isAvailable())
      return { pendingCount: 0, failedCount: 0, lastSyncedAt: null };
    return this.queue.stats();
  }
  setLastSyncedAt(timestamp) {
    return this.write(this.stores.meta, { key: "lastSyncedAt", value: timestamp });
  }
  listOperations() {
    return this.queue.list();
  }
  retryOperation(id) {
    return this.queue.retry(id);
  }
  listCachedResponses(prefix = "") {
    return this.cache.list(prefix);
  }
  deleteCachedResponses(keys) {
    return this.cache.remove(keys);
  }
  async commitOperation(operation, cache, removeCacheKeys = []) {
    return this.commitOperations([operation], cache, removeCacheKeys);
  }
  async commitOperations(operations, cache, removeCacheKeys = []) {
    if (!this.isAvailable())
      throw new Error("Offline storage unavailable");
    await commitStoreChanges(this.connection, this.stores, { operations, cache, removeCacheKeys });
  }
  close() {
    this.connection.close();
  }
  async write(storeName, value) {
    if (!this.isAvailable())
      return;
    await this.connection.request(storeName, "readwrite", (store) => store.put(value));
  }
}
async function commitStoreChanges(connection, stores, {
  operations,
  cache,
  removeCacheKeys,
  removeOperations = []
}) {
  if (!operations.length && !cache.length && !removeCacheKeys.length && !removeOperations.length)
    return;
  await connection.writeBatch([
    ...operations.map((operation) => ({ store: stores.queue, put: operation })),
    ...removeOperations.map((id) => ({ store: stores.queue, remove: id })),
    ...removeCacheKeys.map((key) => ({ store: stores.cache, remove: key })),
    ...cache.map((record) => ({ store: stores.cache, put: record }))
  ]);
}
function createConnection(config, stores, now) {
  return new IndexedDbConnectionAdapter({
    databaseName: config.databaseName,
    version: config.version ?? 1,
    stores,
    obsoleteStoreNames: config.obsoleteStoreNames ?? [],
    openRetryCooldownMs: config.openRetryCooldownMs ?? 60000,
    indexedDb: config.indexedDb,
    now,
    openTimeoutMs: config.openTimeoutMs ?? 3000
  });
}
// src/services/ReplayOperationService.ts
class ReplayOperationService {
  config;
  constructor(config) {
    this.config = config;
  }
  async run(operation) {
    if (this.config.canReplay && !await this.config.canReplay(operation))
      return null;
    const syncingOperation = { ...operation, status: "syncing" };
    await this.config.store.upsertOperation(syncingOperation);
    try {
      const response = await this.send(syncingOperation);
      const responseText = await response.clone().text().catch(() => "");
      await this.handleResponse({ operation: syncingOperation, response, responseText });
      return response;
    } catch (error) {
      await this.retry(syncingOperation, errorMessage(error));
      return null;
    }
  }
  async handleResponse(context) {
    const { operation, response } = context;
    const decision = await this.decision(context);
    const resolved = decision.status === "resolved";
    if (resolved) {
      await this.config.onResolved?.(context);
      await this.config.store.deleteOperation(operation.id);
      await this.config.store.setLastSyncedAt(this.config.now());
    } else if (decision.status === "blocked" || decision.status === "failed") {
      await this.config.store.upsertOperation({
        ...operation,
        status: decision.status,
        lastError: decision.reason ?? `HTTP ${response.status}`
      });
    } else
      await this.retry(operation, decision.reason ?? `HTTP ${response.status}`);
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
  async decision(context) {
    if (this.config.classifyResponse)
      return this.config.classifyResponse(context);
    const resolved = context.response.ok || await this.config.shouldTreatAsResolved?.(context);
    return { status: resolved ? "resolved" : "retry" };
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
      shouldTreatAsResolved: config.shouldTreatAsResolved,
      canReplay: config.canReplay,
      classifyResponse: config.classifyResponse,
      onResolved: config.onResolved
    });
  }
  async start() {
    await this.refreshStats();
    if (this.flushTimer)
      return;
    this.flushTimer = globalThis.setInterval(() => void this.flushWhenNeeded().catch((error) => this.config.onError?.(error)), this.config.flushIntervalMs ?? 3000);
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
  async enqueueOperation(input, cache = []) {
    if (!this.config.store.isAvailable())
      throw new Error("Offline storage unavailable");
    const operation = {
      ...input,
      id: this.createId(),
      attempts: 0,
      nextRetryAt: this.now(),
      status: "pending",
      lastError: null
    };
    if (cache.length && !this.config.store.commitOperation)
      throw new Error("Atomic cache writes unsupported");
    if (cache.length)
      await this.config.store.commitOperation(operation, cache);
    else
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
      await this.refreshStats();
    });
  }
  replayQueuedOperation(operation) {
    if (!this.config.isOnline())
      return Promise.resolve(null);
    return this.runSerialized(async () => {
      const response = await this.replay.run(operation);
      await this.refreshStats();
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
