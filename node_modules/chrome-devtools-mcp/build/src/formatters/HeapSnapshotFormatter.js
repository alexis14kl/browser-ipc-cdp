/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { DevTools } from '../third_party/index.js';
import { stableIdSymbol } from '../utils/id.js';
export function isNodeLike(item) {
    return (typeof item === 'object' && item !== null && 'id' in item && 'name' in item);
}
export function isEdgeLike(item) {
    return (typeof item === 'object' &&
        item !== null &&
        'name' in item &&
        'node' in item &&
        'type' in item &&
        typeof item.node === 'object' &&
        item.node !== null &&
        'id' in item.node &&
        'name' in item.node);
}
export class HeapSnapshotFormatter {
    #aggregates;
    constructor(aggregates) {
        this.#aggregates = aggregates;
    }
    static formatNodes(items) {
        const lines = [];
        if (items.length > 0) {
            const firstItem = items[0];
            if (isNodeLike(firstItem)) {
                lines.push('nodeId,nodeName,type,distance,selfSize,retainedSize');
            }
            else if (isEdgeLike(firstItem)) {
                lines.push('name,type,nodeId,nodeName');
            }
        }
        for (const item of items) {
            if (isNodeLike(item)) {
                lines.push(`${item.id},${item.name},${item.type},${item.distance},${DevTools.I18n.ByteUtilities.formatBytesToKb(item.selfSize)},${DevTools.I18n.ByteUtilities.formatBytesToKb(item.retainedSize)}`);
            }
            else if (isEdgeLike(item)) {
                lines.push(`${item.name},${item.type},${item.node.id},${item.node.name}`);
            }
        }
        return lines.join('\n');
    }
    static formatRetainingPaths(retainingPaths) {
        const lines = [];
        function formatEdge(edge, depth) {
            const indent = '  '.repeat(depth);
            lines.push(`${indent}<- @${edge.nodeId} ${edge.nodeName} via ${edge.edgeType} ${edge.edgeName} (distance: ${edge.distance})`);
            for (const child of edge.children) {
                formatEdge(child, depth + 1);
            }
        }
        for (const path of retainingPaths) {
            formatEdge(path, 0);
        }
        return lines.join('\n');
    }
    static formatDominators(dominators) {
        const lines = [];
        lines.push('nodeId,nodeName,selfSize,retainedSize');
        for (const node of dominators) {
            lines.push(`${node.nodeId},${node.nodeName},${DevTools.I18n.ByteUtilities.formatBytesToKb(node.selfSize)},${DevTools.I18n.ByteUtilities.formatBytesToKb(node.retainedSize)}`);
        }
        return lines.join('\n');
    }
    static formatDuplicateStrings(groups) {
        const lines = [];
        lines.push('value,count,totalSelfSize,totalRetainedSize,truncated,nodeIds');
        for (const group of groups) {
            const nodeIds = group.nodes.map(n => `@${n.id}`).join(' ');
            const truncated = group.truncated ?? false;
            lines.push(`${JSON.stringify(group.value)},${group.count},${DevTools.I18n.ByteUtilities.formatBytesToKb(group.totalSelfSize)},${DevTools.I18n.ByteUtilities.formatBytesToKb(group.totalRetainedSize)},${truncated},${nodeIds}`);
        }
        return lines.join('\n');
    }
    #getSortedAggregates() {
        return Object.values(this.#aggregates).sort((a, b) => b.maxRet - a.maxRet);
    }
    toString() {
        const sorted = this.#getSortedAggregates();
        const lines = [];
        lines.push('id,name,count,selfSize,maxRetainedSize');
        for (const info of sorted) {
            const id = info[stableIdSymbol] ?? '';
            lines.push(`${id},${info.name},${info.count},${DevTools.I18n.ByteUtilities.formatBytesToKb(info.self)},${DevTools.I18n.ByteUtilities.formatBytesToKb(info.maxRet)}`);
        }
        return lines.join('\n');
    }
    toJSON() {
        const sorted = this.#getSortedAggregates();
        return sorted.map(info => ({
            id: info[stableIdSymbol],
            className: info.name,
            count: info.count,
            selfSize: DevTools.I18n.ByteUtilities.formatBytesToKb(info.self),
            retainedSize: DevTools.I18n.ByteUtilities.formatBytesToKb(info.maxRet),
        }));
    }
    static sort(aggregates) {
        return Object.entries(aggregates).sort((a, b) => b[1].maxRet - a[1].maxRet);
    }
    static formatDiffSummary(diffs) {
        const lines = [];
        lines.push('index,className,addedCount,removedCount,countDelta,addedSize,removedSize,sizeDelta');
        let index = 0;
        for (const diff of diffs) {
            lines.push(`${index},${diff.className},${diff.addedCount},${diff.removedCount},${diff.countDelta},${DevTools.I18n.ByteUtilities.formatBytesToKb(diff.addedSize)},${DevTools.I18n.ByteUtilities.formatBytesToKb(diff.removedSize)},${DevTools.I18n.ByteUtilities.formatBytesToKb(diff.sizeDelta)}`);
            index++;
        }
        return lines.join('\n');
    }
    static formatDiffDetails(diff) {
        const lines = [];
        lines.push(`${diff.className}: # new: ${diff.addedCount}, # deleted: ${diff.removedCount}, # delta: ${formatSignedCount(diff.countDelta)}, alloc size: ${formatSignedSize(diff.addedSize)}, freed size: ${formatSignedSize(diff.removedSize)}, size delta: ${formatSignedSize(diff.sizeDelta)}`);
        const addedIds = diff.addedIds;
        const addedSelfSizes = diff.addedSelfSizes;
        const deletedIds = diff.deletedIds;
        const deletedSelfSizes = diff.deletedSelfSizes;
        lines.push(`Objects:`);
        for (let i = 0; i < addedIds.length; i++) {
            lines.push(`  + @${addedIds[i]} (self_size: ${DevTools.I18n.ByteUtilities.formatBytesToKb(addedSelfSizes[i])})`);
        }
        for (let i = 0; i < deletedIds.length; i++) {
            lines.push(`  - @${deletedIds[i]} (self_size: ${DevTools.I18n.ByteUtilities.formatBytesToKb(deletedSelfSizes[i])})`);
        }
        return lines.join('\n');
    }
}
function formatSignedCount(n) {
    return n > 0 ? `+${n}` : `${n}`;
}
function formatSignedSize(bytes) {
    const formatted = DevTools.I18n.ByteUtilities.formatBytesToKb(bytes);
    return bytes > 0 ? `+${formatted}` : formatted;
}
//# sourceMappingURL=HeapSnapshotFormatter.js.map