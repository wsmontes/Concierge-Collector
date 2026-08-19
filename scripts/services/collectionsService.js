/**
 * Online-only bridge for the Collections modal. This service deliberately
 * never touches DataStore, Dexie, SyncManager or any local mutation queue.
 */
const CollectionsServiceClass = ModuleWrapper.defineClass('CollectionsServiceClass', class {
    constructor({ apiService = window.ApiService, authService = window.AuthService, fetchImpl = window.fetch, config = window.AppConfig, uuid = () => window.crypto.randomUUID() } = {}) {
        this.apiService = apiService;
        this.authService = authService;
        this.fetch = fetchImpl;
        this.config = config;
        this.uuid = uuid;
        this.pendingKeys = new Map();
    }

    isOnlineHint() {
        return navigator.onLine !== false;
    }

    async getPublishedAssociations(curationId) {
        return this.apiService.getCurationCollections(curationId);
    }

    async getDraftOptions(curationId) {
        return this._request('GET', `${this.config.cms.endpoints.collectionOptions}/${encodeURIComponent(curationId)}/collection-options`);
    }

    async createSingleCurationOperation({ collectionId, curationId, action, draftRevision }) {
        if (!this.isOnlineHint()) throw new CollectionsError('offline', 0, true);
        if (!['add', 'remove'].includes(action) || !Number.isInteger(draftRevision)) {
            throw new CollectionsError('invalid_request', 400, false);
        }
        const logicalKey = `${collectionId}\u0000${curationId}\u0000${action}\u0000${draftRevision}`;
        const idempotencyKey = this.pendingKeys.get(logicalKey) || this.uuid();
        this.pendingKeys.set(logicalKey, idempotencyKey);
        try {
            const response = await this._request(
                'POST',
                `${this.config.cms.endpoints.collectionOperation}/${encodeURIComponent(collectionId)}/draft/operations`,
                { action, curation_ids: [curationId], draft_revision: draftRevision, mode: 'explicit' },
                { 'Idempotency-Key': idempotencyKey, 'If-Match': String(draftRevision) }
            );
            return response;
        } catch (error) {
            // A network outcome is unknown; preserve its key so retry remains
            // idempotent. Definitive 4xx responses can start a new attempt.
            if (!(error instanceof CollectionsError) || error.retryable === false) this.pendingKeys.delete(logicalKey);
            throw error;
        }
    }

    async getOperation(operationId) {
        return this._request('GET', `${this.config.cms.endpoints.operation}/${encodeURIComponent(operationId)}`);
    }

    async _request(method, path, body = undefined, extraHeaders = {}) {
        if (!this.isOnlineHint()) throw new CollectionsError('offline', 0, true);
        const token = this.authService?.getToken?.();
        if (!token) throw new CollectionsError('authentication_required', 401, false);
        const headers = {
            Authorization: `Bearer ${token}`,
            'X-Request-Id': this.uuid(),
            ...extraHeaders
        };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        let response;
        try {
            response = await this.fetch(`${this.config.cms.adminBaseUrl}${path}`, {
                method, headers, credentials: 'omit', ...(body === undefined ? {} : { body: JSON.stringify(body) })
            });
        } catch (_) {
            throw new CollectionsError('network_error', 0, true);
        }
        if (!response.ok) {
            let code = 'service_unavailable';
            try { code = (await response.json())?.error?.code || code; } catch (_) {}
            throw new CollectionsError(code, response.status, [409, 412, 423, 503].includes(response.status));
        }
        return response.json();
    }
});

class CollectionsError extends Error {
    constructor(code, status, retryable) {
        super(code);
        this.code = code;
        this.status = status;
        this.retryable = retryable;
    }
}

window.CollectionsError = CollectionsError;
window.CollectionsServiceClass = CollectionsServiceClass;
