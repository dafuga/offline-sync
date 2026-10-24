# Feature: Bounded Cache Prefix Reads

## Overview

Keep status and progress reads responsive when a project has a large offline response cache. Prefix queries must read matching records without materializing unrelated response bodies, including when the caller injects an IndexedDB factory without browser globals.

## Acceptance Criteria

- Prefix results preserve key order and include every matching string key, including Unicode suffixes.
- A metadata query over a cache containing large unrelated bodies materializes only matching bodies.
- Empty-prefix reads retain the existing complete-cache behavior; missing prefixes return an empty list.
- Normal library checks, cleanup, and representative time/memory observations pass.

## Future Enhancements

- Cancellation of long complete-cache reads.
