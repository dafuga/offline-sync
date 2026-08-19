import { describe, expect, it } from 'vitest';
import { reconcileVersionedDataset } from '../../src/utils/reconcileVersionedDataset';

interface TestItem {
	syncKey: string;
	contentRevision: string;
	content: string;
}

describe('reconcileVersionedDataset', () => {
	it('replaces changed content in place and retains unchanged object identity', () => {
		const first = item('word:1', '1', 'old first');
		const second = item('word:2', '1', 'unchanged second');
		const changedFirst = item('word:1', '2', 'new first');

		const result = reconcileVersionedDataset([first, second], [changedFirst, { ...second }]);

		expect(result.items).toEqual([changedFirst, second]);
		expect(result.items[1]).toBe(second);
		expect(result.updatedItems).toEqual([changedFirst]);
		expect(result.unchangedItems).toEqual([second]);
	});

	it('appends new keys once and uses the last duplicate incoming value', () => {
		const current = item('word:1', '1', 'first');
		const staleAddition = item('word:2', '1', 'stale addition');
		const latestAddition = item('word:2', '2', 'latest addition');

		const result = reconcileVersionedDataset([current], [staleAddition, latestAddition]);

		expect(result.items).toEqual([current, latestAddition]);
		expect(result.addedItems).toEqual([latestAddition]);
	});

	it('removes deleted keys even when the same key is incoming', () => {
		const removed = item('word:1', '1', 'removed');
		const retained = item('word:2', '1', 'retained');

		const result = reconcileVersionedDataset(
			[removed, retained],
			[item('word:1', '2', 'should not return')],
			{ deletedKeys: ['word:1'] }
		);

		expect(result.items).toEqual([retained]);
		expect(result.removedItems).toEqual([removed]);
		expect(result.unchangedItems).toEqual([retained]);
	});
});

function item(syncKey: string, contentRevision: string, content: string): TestItem {
	return { syncKey, contentRevision, content };
}
