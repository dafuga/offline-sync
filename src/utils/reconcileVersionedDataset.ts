export interface RevisionedDatasetItem {
	syncKey: string;
	contentRevision: string;
}

export interface ReconcileVersionedDatasetOptions {
	deletedKeys?: readonly string[];
}

export interface ReconciledVersionedDataset<T extends RevisionedDatasetItem> {
	items: T[];
	addedItems: T[];
	updatedItems: T[];
	unchangedItems: T[];
	removedItems: T[];
}

export function reconcileVersionedDataset<T extends RevisionedDatasetItem>(
	currentItems: readonly T[],
	incomingItems: readonly T[],
	options: ReconcileVersionedDatasetOptions = {}
): ReconciledVersionedDataset<T> {
	const deletedKeys = new Set(options.deletedKeys ?? []);
	const incomingByKey = new Map(incomingItems.map((item) => [item.syncKey, item]));
	const items: T[] = [];
	const updatedItems: T[] = [];
	const unchangedItems: T[] = [];
	const removedItems: T[] = [];

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
