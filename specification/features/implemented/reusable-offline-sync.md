# Feature: Reusable Offline Sync

## Overview

Provide a framework-neutral TypeScript package that gives browser and Capacitor apps a
drop-in IndexedDB response cache and durable offline mutation queue. Applications supply
configuration and policy callbacks instead of copying storage or retry code.

## Acceptance Criteria

- The package exports typed cache records, queued operations, sync statistics, storage
  contracts, and configuration contracts without importing Fluora, Svelte, or Capacitor.
- An IndexedDB adapter accepts the database name, schema version, store names, retry
  cooldown, and obsolete stores while preserving an existing compatible database.
- The sync engine accepts injected storage, network state, fetch, retry policy, replay
  headers, and resolution policy.
- Queued mutations replay in creation order, use exponential backoff, become failed after
  the configured attempt limit, and expose current sync statistics.
- Multiple engine callers are serialized so an operation cannot be replayed concurrently.
- Public APIs have focused automated coverage, including IndexedDB open cooldown and
  successful, retrying, and policy-resolved replay paths.
- The README documents installation and a complete minimal integration example.
- The package passes its full Harness check and produces a consumable build.

## Future Enhancements

- Add optional SQLite and filesystem storage adapters.
- Add first-class conflict-resolution strategies and queue inspection UI helpers.
- Publish the package to npm after the GitHub-pinned adoption path is proven.
