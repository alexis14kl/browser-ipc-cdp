/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fsSync from 'node:fs';
import path from 'node:path';
import { DevTools } from './third_party/index.js';
import { createIdGenerator, stableIdSymbol, } from './utils/id.js';
export class HeapSnapshotManager {
    #snapshotIdGenerator = createIdGenerator();
    #snapshots = new Map();
    async getSnapshot(filePath) {
        const absolutePath = path.resolve(filePath);
        const cached = this.#snapshots.get(absolutePath);
        if (cached) {
            return cached.snapshot;
        }
        const uid = this.#snapshotIdGenerator();
        const { snapshot, worker } = await this.#loadSnapshot(absolutePath, uid);
        this.#snapshots.set(absolutePath, {
            snapshot,
            worker,
            idToClassKey: [''],
            classKeyToId: new Map(),
        });
        return snapshot;
    }
    async getAggregates(filePath, filterName) {
        const snapshot = await this.getSnapshot(filePath);
        const filter = new DevTools.HeapSnapshotModel.HeapSnapshotModel.NodeFilter();
        if (filterName) {
            filter.filterName = filterName;
        }
        const aggregates = await snapshot.aggregatesWithFilter(filter);
        let objectCount = 0;
        let totalSelfSize = 0;
        for (const [key, aggregate] of Object.entries(aggregates)) {
            const id = await this.getOrCreateIdForClassKey(filePath, key);
            aggregate[stableIdSymbol] = id;
            objectCount += aggregate.count;
            totalSelfSize += aggregate.self;
        }
        return {
            aggregates,
            objectCount,
            totalSelfSize,
        };
    }
    async getStats(filePath) {
        const snapshot = await this.getSnapshot(filePath);
        return await snapshot.getStatistics();
    }
    async getStaticData(filePath) {
        const snapshot = await this.getSnapshot(filePath);
        return snapshot.staticData;
    }
    async getOrCreateIdForClassKey(filePath, classKey) {
        const cached = this.#getCachedSnapshot(filePath);
        let id = cached.classKeyToId.get(classKey);
        if (!id) {
            id = cached.idToClassKey.length;
            cached.classKeyToId.set(classKey, id);
            cached.idToClassKey.push(classKey);
        }
        return id;
    }
    async getNodesById(filePath, id, filterName) {
        const snapshot = await this.getSnapshot(filePath);
        const filter = new DevTools.HeapSnapshotModel.HeapSnapshotModel.NodeFilter();
        if (filterName) {
            filter.filterName = filterName;
        }
        const className = await this.resolveClassKeyFromId(filePath, id);
        if (!className) {
            throw new Error(`Class with ID ${id} not found in heap snapshot`);
        }
        const provider = snapshot.createNodesProviderForClass(className, filter);
        return await provider.serializeItemsRange(0, Infinity);
    }
    async getRetainers(filePath, nodeId) {
        const snapshot = await this.getSnapshot(filePath);
        const nodeIndex = await snapshot.nodeIndexForId(nodeId);
        if (nodeIndex === undefined) {
            throw new Error(`Node with ID ${nodeId} not found`);
        }
        const provider = snapshot.createRetainingEdgesProvider(nodeIndex);
        return await provider.serializeItemsRange(0, Infinity);
    }
    async getRetainingPaths(filePath, nodeId, maxDepth, maxNodes, maxSiblings) {
        const snapshot = await this.getSnapshot(filePath);
        const nodeIndex = await snapshot.nodeIndexForId(nodeId);
        if (nodeIndex === undefined) {
            throw new Error(`Node with ID ${nodeId} not found`);
        }
        return await snapshot.getRetainingPaths(nodeIndex, maxDepth, maxNodes, maxSiblings);
    }
    async getDominatorsOf(filePath, nodeId) {
        const snapshot = await this.getSnapshot(filePath);
        const nodeIndex = await snapshot.nodeIndexForId(nodeId);
        if (nodeIndex === undefined) {
            throw new Error(`Node with ID ${nodeId} not found`);
        }
        return await snapshot.getDominatorsOf(nodeIndex);
    }
    async getEdges(filePath, nodeId) {
        const snapshot = await this.getSnapshot(filePath);
        const nodeIndex = await snapshot.nodeIndexForId(nodeId);
        if (nodeIndex === undefined) {
            throw new Error(`Node with ID ${nodeId} not found`);
        }
        const provider = snapshot.createEdgesProvider(nodeIndex);
        return await provider.serializeItemsRange(0, Infinity);
    }
    async getClassDiffs(baseFilePath, currentFilePath) {
        const rawDiffs = await this.#getSortedRawClassDiffs(baseFilePath, currentFilePath);
        return rawDiffs.map(rawDiff => ({
            className: rawDiff.name,
            addedCount: rawDiff.addedCount,
            removedCount: rawDiff.removedCount,
            countDelta: rawDiff.countDelta,
            addedSize: rawDiff.addedSize,
            removedSize: rawDiff.removedSize,
            sizeDelta: rawDiff.sizeDelta,
        }));
    }
    async getDetailedClassDiff(baseFilePath, currentFilePath, classIndex) {
        const classDiffs = await this.#getSortedRawClassDiffs(baseFilePath, currentFilePath);
        const rawDiff = classDiffs[classIndex];
        if (!rawDiff) {
            throw new Error(`Invalid classIndex: ${classIndex}. Total classes with changes: ${classDiffs.length}`);
        }
        return {
            className: rawDiff.name,
            addedCount: rawDiff.addedCount,
            removedCount: rawDiff.removedCount,
            countDelta: rawDiff.countDelta,
            addedSize: rawDiff.addedSize,
            removedSize: rawDiff.removedSize,
            sizeDelta: rawDiff.sizeDelta,
            addedIds: rawDiff.addedIds ?? [],
            addedSelfSizes: rawDiff.addedSelfSizes ?? [],
            deletedIds: rawDiff.deletedIds ?? [],
            deletedSelfSizes: rawDiff.deletedSelfSizes ?? [],
        };
    }
    #getCachedSnapshot(filePath) {
        const absolutePath = path.resolve(filePath);
        const cached = this.#snapshots.get(absolutePath);
        if (!cached) {
            throw new Error(`Snapshot not loaded for ${filePath}`);
        }
        return cached;
    }
    async #getSortedRawClassDiffs(baseFilePath, currentFilePath) {
        const baseSnapshot = await this.getSnapshot(baseFilePath);
        const currentSnapshot = await this.getSnapshot(currentFilePath);
        const interfaceDefinitions = await currentSnapshot.interfaceDefinitions();
        const aggregatesForDiff = await baseSnapshot.aggregatesForDiff(interfaceDefinitions);
        const baseSnapshotId = baseSnapshot.uid;
        if (baseSnapshotId === undefined) {
            throw new Error('Base snapshot UID is undefined');
        }
        // DevTools calculateSnapshotDiff uses the first parameter (baseSnapshotId)
        // as a cache key. We pass the unique UID of the base snapshot.
        const rawDiffs = await currentSnapshot.calculateSnapshotDiff(baseSnapshotId, aggregatesForDiff);
        // Return a filtered and sorted array here to ensure that
        // compare_heapsnapshot_summary and compare_heapsnapshot_details agree
        // on indices.
        return Object.values(rawDiffs)
            .filter(diff => diff.addedCount > 0 || diff.removedCount > 0)
            .sort((a, b) => b.sizeDelta - a.sizeDelta);
    }
    async resolveClassKeyFromId(filePath, id) {
        const cached = this.#getCachedSnapshot(filePath);
        return cached.idToClassKey[id];
    }
    async #loadSnapshot(absolutePath, uid) {
        const workerProxy = new DevTools.HeapSnapshotModel.HeapSnapshotProxy.HeapSnapshotWorkerProxy(() => {
            /* noop */
        }, import.meta.resolve('./third_party/devtools-heap-snapshot-worker.js'));
        const { promise: snapshotPromise, resolve: resolveSnapshot } = Promise.withResolvers();
        const loaderProxy = workerProxy.createLoader(uid, snapshotProxy => {
            resolveSnapshot(snapshotProxy);
        });
        const fileStream = fsSync.createReadStream(absolutePath, {
            encoding: 'utf-8',
            highWaterMark: 1024 * 1024,
        });
        for await (const chunk of fileStream) {
            await loaderProxy.write(chunk);
        }
        await loaderProxy.close();
        const snapshot = await snapshotPromise;
        return { snapshot, worker: workerProxy };
    }
    async getDuplicateStrings(filePath) {
        const snapshot = await this.getSnapshot(filePath);
        return await snapshot.getDuplicateStrings();
    }
    hasSnapshots() {
        return this.#snapshots.size > 0;
    }
    dispose(filePath) {
        const absolutePath = path.resolve(filePath);
        const cached = this.#snapshots.get(absolutePath);
        if (cached) {
            cached.worker.dispose();
            this.#snapshots.delete(absolutePath);
            return true;
        }
        return false;
    }
}
//# sourceMappingURL=HeapSnapshotManager.js.map