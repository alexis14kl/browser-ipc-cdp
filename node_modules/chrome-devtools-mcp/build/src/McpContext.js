/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { overrideDevToolsGlobals } from './devtools/DevtoolsUtils.js';
import { HeapSnapshotManager } from './HeapSnapshotManager.js';
import { McpPage } from './McpPage.js';
import { ServiceWorkerConsoleCollector } from './ServiceWorkerCollector.js';
import { Locator, } from './third_party/index.js';
import { listPages } from './tools/pages.js';
import { CLOSE_PAGE_ERROR } from './tools/ToolDefinition.js';
import { getTempFilePath, resolveCanonicalPath } from './utils/files.js';
// Page ids are handed out from a process-wide counter so they stay unique
// across all contexts, in particular across browser reconnects. An id issued
// before a reconnect then fails to resolve instead of hitting an unrelated
// page of the reconnected browser.
let nextPageId = 1;
export class McpContext {
    browser;
    logger;
    // Maps LLM-provided isolatedContext name → Puppeteer BrowserContext.
    #isolatedContexts = new Map();
    // Auto-generated name counter for when no name is provided.
    #nextIsolatedContextId = 1;
    #extensionServiceWorkers = [];
    #mcpPages = new Map();
    #selectedPage;
    #selectedPageFallback;
    #serviceWorkerConsoleCollector;
    #isRunningTrace = false;
    #screenRecorderData = null;
    #reconnectNotice = false;
    #extensionPages = new WeakMap();
    #extensionServiceWorkerMap = new WeakMap();
    #nextExtensionServiceWorkerId = 1;
    #traceResults = [];
    #locatorClass;
    #options;
    #heapSnapshotManager = new HeapSnapshotManager();
    #roots = undefined;
    #allowUnrestrictedPaths;
    constructor(browser, logger, options, locatorClass) {
        overrideDevToolsGlobals({
            loadResource: (url) => {
                return this.loadResource(url);
            },
        });
        this.browser = browser;
        this.logger = logger;
        this.#locatorClass = locatorClass;
        this.#options = options;
        this.#allowUnrestrictedPaths = options.allowUnrestrictedPaths ?? false;
        this.#reconnectNotice = options.reconnected ?? false;
        this.#serviceWorkerConsoleCollector = new ServiceWorkerConsoleCollector(this.browser);
    }
    async #init() {
        await this.createPagesSnapshot();
        const workers = await this.createExtensionServiceWorkersSnapshot();
        await this.#serviceWorkerConsoleCollector.init(workers);
        this.browser.on('targetcreated', this.#onTargetCreated);
        this.browser.on('targetdestroyed', this.#onTargetDestroyed);
    }
    dispose() {
        this.browser.off('targetcreated', this.#onTargetCreated);
        this.browser.off('targetdestroyed', this.#onTargetDestroyed);
        this.#serviceWorkerConsoleCollector.dispose();
        for (const mcpPage of this.#mcpPages.values()) {
            mcpPage.dispose();
        }
        this.#mcpPages.clear();
        // Isolated contexts are intentionally not closed here.
        // Either the entire browser will be closed or we disconnect
        // without destroying browser state.
        this.#isolatedContexts.clear();
    }
    #onTargetCreated = async (target) => {
        try {
            const page = await target.page();
            if (!page) {
                return;
            }
            void this.#createMcpPage(page);
        }
        catch (err) {
            this.logger?.('Error handling targetcreated', err);
        }
    };
    #onTargetDestroyed = (target) => {
        try {
            let foundPage;
            for (const page of this.#mcpPages.keys()) {
                if (page.target() === target) {
                    foundPage = page;
                    break;
                }
            }
            if (!foundPage) {
                return;
            }
            const mcpPage = this.#mcpPages.get(foundPage);
            if (mcpPage) {
                mcpPage.dispose();
                this.#mcpPages.delete(foundPage);
            }
        }
        catch (err) {
            this.logger?.('Error handling targetdestroyed', err);
        }
    };
    static async from(browser, logger, opts, 
    /* Let tests use unbundled Locator class to avoid overly strict checks within puppeteer that fail when mixing bundled and unbundled class instances */
    locatorClass = Locator) {
        const context = new McpContext(browser, logger, opts, locatorClass);
        await context.#init();
        return context;
    }
    static resetPageIdsForTesting() {
        nextPageId = 1;
    }
    roots() {
        return [
            ...(this.#roots ?? []),
            {
                uri: pathToFileURL(os.tmpdir()).href,
                name: 'temp',
            },
        ];
    }
    setRoots(roots) {
        this.#roots = roots;
    }
    async validatePath(filePath) {
        if (filePath === undefined) {
            return;
        }
        // If the client never negotiated roots and the operator has explicitly
        // opted into unrestricted access via --allow-unrestricted-paths, restore
        // the previous permissive behavior and skip validation.
        if (this.#roots === undefined && this.#allowUnrestrictedPaths) {
            return;
        }
        // roots() always returns at least the temp directory, even if the
        // connecting client never negotiated the optional `roots` capability.
        // Path validation must not be skipped just because no workspace roots
        // were configured.
        const roots = this.roots();
        let canonicalPath;
        try {
            canonicalPath = await resolveCanonicalPath(filePath);
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(`[MCP Context] Error resolving real path for ${filePath}: ${errMsg}`);
            throw new Error(`Access denied: Cannot resolve base path for ${filePath}.`);
        }
        let allowed = false;
        const resolvedRoots = await Promise.allSettled(roots.map(async (root) => {
            const rootPathUri = root.uri;
            const rootPath = path.resolve(fileURLToPath(rootPathUri));
            return await fsPromises.realpath(rootPath);
        }));
        for (let i = 0; i < roots.length; i++) {
            const root = roots[i];
            const result = resolvedRoots[i];
            if (result.status === 'fulfilled') {
                const canonicalRoot = result.value;
                if (canonicalPath === canonicalRoot ||
                    canonicalPath.startsWith(canonicalRoot + path.sep)) {
                    allowed = true;
                    break;
                }
            }
            else {
                const rootErr = result.reason;
                const errMsg = rootErr instanceof Error ? rootErr.message : String(rootErr);
                console.warn(`[MCP Context] Could not resolve configured root ${root.uri}: ${errMsg}`);
                // Skip this root if it cannot be resolved.
            }
        }
        if (!allowed) {
            throw new Error(`Access denied: path ${filePath} (canonical: ${canonicalPath}) is not within any of the configured workspace roots.`);
        }
    }
    async ensureExtension(filePath, extension) {
        const resolvedPath = path.resolve(filePath);
        const currentExtension = path.extname(resolvedPath);
        const outputPath = `${resolvedPath.slice(0, resolvedPath.length - currentExtension.length)}${extension}`;
        await this.validatePath(outputPath);
        return outputPath;
    }
    async newPage(background, isolatedContextName) {
        let page;
        if (isolatedContextName !== undefined) {
            let ctx = this.#isolatedContexts.get(isolatedContextName);
            if (!ctx) {
                ctx = await this.browser.createBrowserContext();
                this.#isolatedContexts.set(isolatedContextName, ctx);
            }
            page = await ctx.newPage();
        }
        else {
            page = await this.browser.newPage({ background });
        }
        const mcpPage = await this.#createMcpPage(page);
        await this.createPagesSnapshot();
        this.selectPage(mcpPage);
        return mcpPage;
    }
    async closePage(pageId) {
        if (this.#mcpPages.size === 1) {
            throw new Error(CLOSE_PAGE_ERROR);
        }
        const page = this.getPageById(pageId);
        if (page) {
            page.dispose();
            this.#mcpPages.delete(page.pptrPage);
        }
        await page.pptrPage.close({ runBeforeUnload: false });
    }
    get #hasNetworkBlockOrAllowlist() {
        return !!(this.#options.allowList || this.#options.blocklist);
    }
    setIsRunningPerformanceTrace(x) {
        this.#isRunningTrace = x;
    }
    isRunningPerformanceTrace() {
        return this.#isRunningTrace;
    }
    getScreenRecorder() {
        return this.#screenRecorderData;
    }
    setScreenRecorder(data) {
        this.#screenRecorderData = data;
    }
    isCruxEnabled() {
        return this.#options.performanceCrux;
    }
    getPages() {
        return Array.from(this.#mcpPages.values());
    }
    getSelectedMcpPage() {
        const page = this.#selectedPage;
        if (!page) {
            throw new Error('No page selected');
        }
        if (page.pptrPage.isClosed()) {
            throw new Error(`The selected page has been closed. Call ${listPages().name} to see open pages.`);
        }
        return page;
    }
    /**
     * Returns true once if this context was created by reconnecting after the
     * previous browser connection was lost, so the next response can surface a
     * note. Cleared on first call.
     */
    consumeReconnectNotice() {
        const notice = this.#reconnectNotice;
        this.#reconnectNotice = false;
        return notice;
    }
    getPageById(pageId) {
        const page = this.#mcpPages.values().find(mcpPage => mcpPage.id === pageId);
        if (!page) {
            throw new Error('No page found');
        }
        return page;
    }
    isPageSelected(page) {
        return this.#selectedPage === page;
    }
    selectPage(newPage) {
        this.#selectedPage = newPage;
        newPage.updateTimeouts();
    }
    /**
     * Returns details about the last page snapshot automatically replacing the
     * selection because the selected page disappeared from the page list, or
     * `undefined` if the snapshot left the selection intact. Recomputed on every
     * createPagesSnapshot() call.
     */
    getSelectedPageFallback() {
        return this.#selectedPageFallback;
    }
    /**
     * Creates a snapshot of the extension service workers.
     */
    async createExtensionServiceWorkersSnapshot() {
        const allTargets = this.browser.targets();
        const serviceWorkers = allTargets.filter(target => {
            return (target.type() === 'service_worker' &&
                target.url().includes('chrome-extension://'));
        });
        for (const serviceWorker of serviceWorkers) {
            if (!this.#extensionServiceWorkerMap.has(serviceWorker)) {
                this.#extensionServiceWorkerMap.set(serviceWorker, 'sw-' + this.#nextExtensionServiceWorkerId++);
            }
        }
        this.#extensionServiceWorkers = serviceWorkers.map(serviceWorker => {
            return {
                target: serviceWorker,
                id: this.#extensionServiceWorkerMap.get(serviceWorker),
                url: serviceWorker.url(),
            };
        });
        return this.#extensionServiceWorkers;
    }
    getServiceWorkerConsoleData(extensionId) {
        return this.#serviceWorkerConsoleCollector.getData(extensionId);
    }
    #getBrowserContextToNameMap() {
        // Build a reverse lookup from BrowserContext instance → name.
        const contextToName = new Map();
        for (const [name, ctx] of this.#isolatedContexts) {
            contextToName.set(ctx, name);
        }
        const defaultCtx = this.browser.defaultBrowserContext();
        // Auto-discover BrowserContexts not in our mapping (e.g., externally
        // created incognito contexts) and assign generated names.
        const knownContexts = new Set(this.#isolatedContexts.values());
        for (const ctx of this.browser.browserContexts()) {
            if (ctx !== defaultCtx && !ctx.closed && !knownContexts.has(ctx)) {
                const name = `isolated-context-${this.#nextIsolatedContextId++}`;
                this.#isolatedContexts.set(name, ctx);
                contextToName.set(ctx, name);
            }
        }
        return contextToName;
    }
    async #createMcpPage(page) {
        let mcpPage = this.#mcpPages.get(page);
        if (!mcpPage) {
            mcpPage = new McpPage(page, nextPageId++, {
                locatorClass: this.#locatorClass,
                hasNetworkBlockOrAllowlist: this.#hasNetworkBlockOrAllowlist,
                isolatedContextName: this.#getBrowserContextToNameMap().get(page.browserContext()),
            });
            this.#mcpPages.set(page, mcpPage);
            await mcpPage.init();
        }
        return mcpPage;
    }
    async createPagesSnapshot() {
        const allPages = await this.#fetchBrowserPages();
        await Promise.allSettled(allPages.map(page => this.#createMcpPage(page)));
        // Prune orphaned #mcpPages entries (pages that no longer exist).
        const currentPages = new Set(allPages);
        for (const [page, mcpPage] of this.#mcpPages) {
            if (!currentPages.has(page)) {
                mcpPage.dispose();
                this.#mcpPages.delete(page);
            }
        }
        const pages = Array.from(this.#mcpPages.values());
        // Only fall back when the selected page is actually gone. Gating on
        // `isClosed()` instead of `pages` membership avoids silently swapping a
        // live page that is momentarily missing from the snapshot.
        this.#selectedPageFallback = undefined;
        if ((!this.#selectedPage || this.#selectedPage.pptrPage.isClosed()) &&
            pages[0]) {
            // Record the automatic change so the response can surface it. Skipped on
            // first connect, when there was no prior selection to replace.
            if (this.#selectedPage) {
                this.#selectedPageFallback = {
                    wasClosed: this.#selectedPage.pptrPage.isClosed(),
                };
            }
            this.selectPage(pages[0]);
        }
        return pages.map(p => p.pptrPage);
    }
    async #fetchBrowserPages() {
        const allPages = (await this.browser.pages(this.#options.experimentalIncludeAllPages)).filter(page => {
            return (this.#options.experimentalDevToolsDebugging ||
                !page.url().startsWith('devtools://'));
        });
        const allTargets = this.browser.targets();
        const extensionTargets = allTargets.filter(target => {
            return (target.url().startsWith('chrome-extension://') &&
                target.type() === 'page');
        });
        await Promise.allSettled(extensionTargets.map(async (target) => {
            try {
                let page = await target.page();
                if (!page) {
                    page = await target.asPage();
                }
                this.#extensionPages.set(target, page);
                if (page && !allPages.includes(page)) {
                    allPages.push(page);
                }
            }
            catch (e) {
                this.logger?.('Failed to get page for extension target', e);
            }
        }));
        return allPages;
    }
    getExtensionServiceWorkers() {
        return this.#extensionServiceWorkers;
    }
    getExtensionServiceWorkerId(extensionServiceWorker) {
        return this.#extensionServiceWorkerMap.get(extensionServiceWorker.target);
    }
    async saveTemporaryFile(data, filename) {
        const filepath = await getTempFilePath(filename);
        await this.validatePath(filepath);
        try {
            await fs.writeFile(filepath, data);
        }
        catch (err) {
            throw new Error('Could not save a file', { cause: err });
        }
        return { filepath };
    }
    async saveFile(data, clientProvidedFilePath, extension) {
        const filePath = await this.ensureExtension(clientProvidedFilePath, extension);
        try {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, data);
            return { filename: filePath };
        }
        catch (err) {
            this.logger?.(err);
            throw new Error('Could not save a file', { cause: err });
        }
    }
    storeTraceRecording(result) {
        // Clear the trace results because we only consume the latest trace currently.
        this.#traceResults = [];
        this.#traceResults.push(result);
    }
    recordedTraces() {
        return this.#traceResults;
    }
    async installExtension(extensionPath) {
        const id = await this.browser.installExtension(extensionPath);
        return id;
    }
    async uninstallExtension(id) {
        await this.browser.uninstallExtension(id);
    }
    async triggerExtensionAction(id) {
        const extensions = await this.browser.extensions();
        const extension = extensions.get(id);
        if (!extension) {
            throw new Error(`Extension with ID ${id} not found.`);
        }
        const page = this.getSelectedMcpPage().pptrPage;
        await extension.triggerAction(page);
    }
    listExtensions() {
        return this.browser.extensions();
    }
    async getExtension(id) {
        const pptrExtensions = await this.browser.extensions();
        return pptrExtensions.get(id);
    }
    async getHeapSnapshotAggregates(filePath, filterName) {
        return await this.#heapSnapshotManager.getAggregates(filePath, filterName);
    }
    async getHeapSnapshotDuplicateStrings(filePath) {
        return await this.#heapSnapshotManager.getDuplicateStrings(filePath);
    }
    async getHeapSnapshotStats(filePath) {
        return await this.#heapSnapshotManager.getStats(filePath);
    }
    async getHeapSnapshotStaticData(filePath) {
        return await this.#heapSnapshotManager.getStaticData(filePath);
    }
    async getHeapSnapshotNodesById(filePath, id, filterName) {
        return await this.#heapSnapshotManager.getNodesById(filePath, id, filterName);
    }
    async getHeapSnapshotRetainers(filePath, nodeId) {
        return await this.#heapSnapshotManager.getRetainers(filePath, nodeId);
    }
    async closeHeapSnapshot(filePath) {
        return this.#heapSnapshotManager.dispose(filePath);
    }
    hasHeapSnapshots() {
        return this.#heapSnapshotManager.hasSnapshots();
    }
    async getHeapSnapshotRetainingPaths(filePath, nodeId, maxDepth, maxNodes, maxSiblings) {
        return await this.#heapSnapshotManager.getRetainingPaths(filePath, nodeId, maxDepth, maxNodes, maxSiblings);
    }
    async getHeapSnapshotDominators(filePath, nodeId) {
        return await this.#heapSnapshotManager.getDominatorsOf(filePath, nodeId);
    }
    #validateUrlNotBlocked(url) {
        if (!this.#options.blocklist) {
            return;
        }
        for (const block of this.#options.blocklist) {
            const pattern = new URLPattern(block);
            if (pattern.test(url)) {
                throw new Error(`Blocked by blocklist: ${url}`);
            }
        }
    }
    #validateUrlAllowed(url) {
        if (!this.#options.allowList) {
            return;
        }
        for (const allow of this.#options.allowList) {
            const pattern = new URLPattern(allow);
            if (pattern.test(url)) {
                return;
            }
        }
        throw new Error(`Not allowed by allowlist: ${url}`);
    }
    async loadResource(path) {
        const url = new URL(path);
        this.#validateUrlNotBlocked(url);
        switch (url.protocol) {
            case 'https:':
            case 'http:': {
                this.#validateUrlAllowed(url);
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`Failed to load resource: ${url}`);
                }
                return response.text();
            }
            case 'file:': {
                await this.validatePath(fileURLToPath(url));
                return await fsPromises.readFile(url, 'utf-8');
            }
            default:
                throw new Error(`Unsupported protocol for: ${url}`);
        }
    }
    async getHeapSnapshotEdges(filePath, nodeId) {
        return await this.#heapSnapshotManager.getEdges(filePath, nodeId);
    }
    async getHeapSnapshotClassDiffs(baseFilePath, currentFilePath) {
        return await this.#heapSnapshotManager.getClassDiffs(baseFilePath, currentFilePath);
    }
    async getHeapSnapshotDetailedClassDiff(baseFilePath, currentFilePath, classIndex) {
        return await this.#heapSnapshotManager.getDetailedClassDiff(baseFilePath, currentFilePath, classIndex);
    }
}
//# sourceMappingURL=McpContext.js.map