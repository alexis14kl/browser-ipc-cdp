/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { stableIdSymbol } from '../utils/id.js';
export function isNodeLike(item) {
    return (typeof item === 'object' && item !== null && 'id' in item && 'name' in item);
}
export class HeapSnapshotFormatter {
    #aggregates;
    constructor(aggregates) {
        this.#aggregates = aggregates;
    }
    static formatNodes(items) {
        const lines = [];
        if (items.length > 0 && isNodeLike(items[0])) {
            lines.push('id,name,type,distance,selfSize,retainedSize');
        }
        for (const item of items) {
            if (isNodeLike(item)) {
                lines.push(`${item.id},"${item.name}",${item.type},${item.distance},${item.selfSize},${item.retainedSize}`);
            }
        }
        return lines.join('\n');
    }
    #getSortedAggregates() {
        return Object.values(this.#aggregates).sort((a, b) => b.maxRet - a.maxRet);
    }
    toString() {
        const sorted = this.#getSortedAggregates();
        const lines = [];
        lines.push('uid,className,count,selfSize,maxRetainedSize');
        for (const info of sorted) {
            const uid = info[stableIdSymbol] ?? '';
            lines.push(`${uid},"${info.name}",${info.count},${info.self},${info.maxRet}`);
        }
        return lines.join('\n');
    }
    toJSON() {
        const sorted = this.#getSortedAggregates();
        return sorted.map(info => ({
            uid: info[stableIdSymbol],
            className: info.name,
            count: info.count,
            selfSize: info.self,
            retainedSize: info.maxRet,
        }));
    }
    static sort(aggregates) {
        return Object.entries(aggregates).sort((a, b) => b[1].maxRet - a[1].maxRet);
    }
}
//# sourceMappingURL=HeapSnapshotFormatter.js.map