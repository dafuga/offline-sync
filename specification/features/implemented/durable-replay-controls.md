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
- BuildFlexity continues to pin the immutable candidate commit while this
  reusable package change lands on `main`; Fluora's installed pin is unchanged.

## Verification

- `bun run check` passed on the feature head: formatting, type checking, lint,
  22 unit tests in six files, build, and Harness audit.
- GitHub PR #1 has no required checks or reviews; this merge does not publish
  a package version. Native BuildFlexity acceptance remains a separate gate.

## Future Enhancements

- Additional storage adapters and cross-process replay leasing.
