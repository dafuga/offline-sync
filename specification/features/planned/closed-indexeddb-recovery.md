# Feature: Closed IndexedDB connection recovery

## Overview

iOS can close an IndexedDB connection while a native app remains running. BuildFlexity physical iPhone acceptance reproduced InvalidStateError at transaction creation, leaving plan reads empty despite a completed download. The shared adapter currently retains the closed connection promise.

Coverage gap: the standardized adapter storage scenario only uses a continuously open connection. Extend it with connection loss before reads, queue writes, atomic writes and concurrent reads. Preserve records and queued work, retry only transaction creation when no transaction has started, and keep failures after transaction creation visible.

## Acceptance Criteria

- The same storage/queue/meta scenario passes with an open connection and after forced closure before reads, queue writes, atomic writes and concurrent reads.
- A closed connection is reopened once, retaining cached data and queue ordering.
- Concurrent recovery does not close a newer replacement connection.
- Errors after a transaction starts, including quota and abort errors, are not retried.
- Complete library check passes and BuildFlexity verifies existing downloaded plan pages on the connected iPhone.

## Future Enhancements

- Collect aggregate connection-recovery diagnostics without recording stored content.
