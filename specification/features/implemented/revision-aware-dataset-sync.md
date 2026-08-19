# Feature: Revision Aware Dataset Sync

## Overview

Allow applications to reconcile cached dataset entries with fresh server entries by stable
identity and content revision. A changed server entry replaces stale cached content in place,
while unchanged entries retain their existing object and ordering and new entries append to the
dataset.

## Acceptance Criteria

- The package exports a typed revision-aware dataset item contract.
- Reconciliation identifies entries through an application-supplied stable key.
- A matching key with a different content revision replaces the cached entry in its current
  position.
- A matching key with the same content revision remains unchanged.
- A previously unseen key appends once, and duplicate incoming keys resolve deterministically to
  the newest incoming value.
- Application-supplied deleted keys remove matching cached entries.
- Reconciliation reports added, updated, unchanged, and removed entries separately so an
  application can persist or present the resulting sync state.
- Focused unit tests cover changed content, unchanged content, additions, duplicate changes,
  deletions, and stable ordering.
- Package documentation explains that applications own revision generation and network refresh
  timing.

## Future Enhancements

- Add an optional persistent dataset repository on top of the existing offline store contract.
- Add cursor-based delta-fetch orchestration after multiple applications prove a common wire
  protocol.
