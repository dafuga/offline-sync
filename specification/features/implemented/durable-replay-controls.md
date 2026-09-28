# Feature: Durable Replay Controls

## Overview

Extend framework-neutral caching/replay for BuildFlexity while Fluora keeps its
existing dependency. Application policy stays behind adapters and hooks.

## Acceptance Criteria

- Durable queue writes/acknowledgments reject unavailable storage.
- Public queue/cache inspection, retry/discard, and atomic operation/cache writes.
- Eligibility and result hooks support dependencies, auth pauses, conflicts, and
  permanent failures; reconciliation finishes before queue acknowledgment.
- Interrupted replay recovers, replay stays serialized, and only acknowledged work
  advances the last-success timestamp.
- Existing APIs and legacy resolution policies remain compatible.
- Red-green regressions, checks/build/audit, and consumer compatibility pass.
- Changes remain on a feature branch and draft PR, pinned by immutable commit.

## Future Enhancements

- Additional storage adapters and cross-process replay leasing.
