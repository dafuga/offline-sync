# @dafuga01/offline-sync

Framework-neutral IndexedDB response caching and durable offline mutation replay for
TypeScript browser and Capacitor applications.

## Install

```bash
bun add github:dafuga/offline-sync#v0.1.1
```

The package has no runtime dependencies and does not import Svelte, React, Capacitor, or
an application-specific API client.

## Minimal setup

```ts
import {
	IndexedDbOfflineStoreAdapter,
	OfflineSyncEngineService,
	buildCacheKey
} from '@dafuga01/offline-sync';

const store = new IndexedDbOfflineStoreAdapter({
	databaseName: 'my-app-offline',
	version: 1
});

const sync = new OfflineSyncEngineService({
	store,
	isOnline: () => navigator.onLine,
	credentials: 'include',
	applyReplayHeaders(headers, operation) {
		headers.set('X-Offline-Operation-Id', operation.id);
		headers.set('X-Client-Occurred-At', String(operation.occurredAt));
	},
	shouldTreatAsResolved({ response }) {
		return response.status === 409;
	},
	onStats(stats) {
		console.info('offline sync', stats);
	}
});

await sync.start();
```

Cache a successful response:

```ts
const response = await fetch('/api/items');
await store.saveCachedResponse({
	key: buildCacheKey(response.url),
	url: response.url,
	status: response.status,
	statusText: response.statusText,
	headers: Object.fromEntries(response.headers.entries()),
	body: await response.clone().text(),
	updatedAt: Date.now()
});
```

Queue a mutation before attempting background replay:

```ts
const operation = await sync.enqueueOperation({
	url: new URL('/api/items', location.origin).toString(),
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({ name: 'Available offline' }),
	createdAt: Date.now(),
	occurredAt: Date.now()
});

if (navigator.onLine) void sync.replayQueuedOperation(operation);
```

## Application-owned policies

The package deliberately leaves these decisions to each app:

- Which GET routes are cacheable.
- Which mutations may be safely queued.
- Authentication and replay headers.
- Which non-2xx responses mean an idempotent mutation was already applied.
- Conflict resolution and user-facing sync status.
- When network reachability is considered trustworthy.

Call `sync.stop()` when the owning application lifecycle ends.

## Compatibility and migration

Existing IndexedDB data can be adopted without copying it. Configure the same database
name, version, and store names. Optional `obsoleteStoreNames` are deleted only during an
IndexedDB version upgrade.

## Development

```bash
bun install
bun run check
```

`bun run check` runs formatting, TypeScript, ESLint, Vitest, the browser-targeted package
build, and the Harness audit.
