import { expect, test } from 'vitest';
import { buildCacheKey } from '../src';

test('builds deterministic GET cache keys', () => {
	expect(buildCacheKey('https://example.com/api/items')).toBe('GET:https://example.com/api/items');
});
