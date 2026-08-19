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
export declare function reconcileVersionedDataset<T extends RevisionedDatasetItem>(currentItems: readonly T[], incomingItems: readonly T[], options?: ReconcileVersionedDatasetOptions): ReconciledVersionedDataset<T>;
