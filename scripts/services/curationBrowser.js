/**
 * File: curationBrowser.js
 * Purpose: Navegação paginada sobre curations do servidor.
 * Dependencies: ApiService (injetado), AppConfig (endpoints)
 *
 * Text search has one extra semantic rule: a linked Curation is discoverable
 * by the current canonical Entity name even when curation.restaurant_name is
 * an older captured/working name. We build that bounded union only for `q`;
 * normal browsing keeps the existing server pagination path untouched.
 */
class CurationBrowser {
  constructor({ apiService, pageSize = 25 } = {}) {
    this.apiService = apiService;
    this.pageSize = pageSize;
    this.scope = {};
    this.cursor = null;
    this.done = false;
    this.loading = false;
    this.items = [];
    this.total = -1;
    this._canonicalSearchCache = null;
  }

  openScope({ curatorId = null, status = null, city = null, type = null, q = null, unlinked = false, createdAfter = null } = {}) {
    if (this._scopeChanged({ curatorId, status, city, type, q, unlinked, createdAfter })) {
      this.cursor = null;
      this.done = false;
      this.items = [];
      this.total = -1;
      this._canonicalSearchCache = null;
    }
    this.scope = { curatorId, status, city, type, q, unlinked, createdAfter };
  }

  _scopeChanged(next) {
    const prev = this.scope;
    return prev.curatorId !== next.curatorId
      || prev.status !== next.status
      || prev.city !== next.city
      || prev.type !== next.type
      || prev.q !== next.q
      || !!prev.unlinked !== !!next.unlinked
      || (prev.createdAfter || null) !== (next.createdAfter || null);
  }

  _params(afterId) {
    const p = { limit: this.pageSize };
    if (afterId != null) p.after_id = afterId;
    p.sort_by = this.scope.sortBy || 'updated_at';
    p.sort_order = this.scope.sortOrder || 'desc';
    if (this.scope.curatorId) p.curator_id = this.scope.curatorId;
    if (this.scope.status && this.scope.status !== 'all') p.status = this.scope.status;
    if (this.scope.city) p.city = this.scope.city;
    if (this.scope.type && this.scope.type !== 'all') p.type = this.scope.type;
    if (this.scope.q) p.q = this.scope.q;
    if (this.scope.unlinked) p.unlinked = true;
    if (this.scope.createdAfter) p.created_after = this.scope.createdAfter;
    return p;
  }

  _matchesCanonicalScope(curation) {
    if (!curation) return false;
    if (this.scope.unlinked) return false;

    if (this.scope.curatorId) {
      const curatorId = curation.curator_id || curation.curator?.id || null;
      if (curatorId !== this.scope.curatorId) return false;
    }
    if (this.scope.status && this.scope.status !== 'all' && curation.status !== this.scope.status) {
      return false;
    }
    if (this.scope.createdAfter) {
      const created = curation.createdAt || curation.created_at;
      const createdMs = created ? new Date(created).getTime() : NaN;
      const cutoffMs = new Date(this.scope.createdAfter).getTime();
      if (!Number.isFinite(createdMs) || !Number.isFinite(cutoffMs) || createdMs < cutoffMs) {
        return false;
      }
    }
    return true;
  }

  async _loadCanonicalSearchSet() {
    if (this._canonicalSearchCache) return this._canonicalSearchCache;
    if (!this.scope.q || this.scope.unlinked) {
      const params = { ...this._params(null), limit: 1000, offset: 0 };
      delete params.after_id;
      const resp = await this.apiService.listCurations(params);
      this._canonicalSearchCache = resp.items || [];
      return this._canonicalSearchCache;
    }

    const params = { ...this._params(null), limit: 1000, offset: 0 };
    delete params.after_id;

    const entityParams = { q: this.scope.q, limit: 100 };
    if (this.scope.city) entityParams.city = this.scope.city;
    if (this.scope.type && this.scope.type !== 'all') entityParams.type = this.scope.type;

    const [curationResponse, entityResponse] = await Promise.all([
      this.apiService.listCurations(params),
      this.apiService.listEntities(entityParams)
    ]);

    const serverMatches = curationResponse.items || [];
    const entities = entityResponse.items || [];
    const entityIds = [...new Set(entities.map((entity) => entity?.entity_id || entity?.id).filter(Boolean))];

    const linkedGroups = await Promise.all(
      entityIds.map(async (entityId) => {
        try {
          const rows = await this.apiService.getEntityCurations(entityId);
          return Array.isArray(rows) ? rows : [];
        } catch (error) {
          console.warn('[CurationBrowser] canonical Entity curation lookup failed:', entityId, error);
          return [];
        }
      })
    );

    const merged = new Map();
    const add = (curation) => {
      const id = curation?.curation_id || curation?._id;
      if (!id || merged.has(String(id))) return;
      merged.set(String(id), curation);
    };
    serverMatches.forEach(add);
    linkedGroups.flat().filter((curation) => this._matchesCanonicalScope(curation)).forEach(add);

    const all = [...merged.values()];
    const sortKey = (item) => {
      const raw = item?.updatedAt || item?.updated_at || item?.createdAt || item?.created_at || 0;
      const time = new Date(raw).getTime();
      return Number.isFinite(time) ? time : 0;
    };
    const direction = this.scope.sortOrder === 'asc' ? 1 : -1;
    all.sort((a, b) => (sortKey(a) - sortKey(b)) * direction);

    this._canonicalSearchCache = all;
    return all;
  }

  async _fetch(afterId) {
    const resp = await this.apiService.listCurations(this._params(afterId));
    return { items: resp.items || [], total: resp.total };
  }

  async nextPage() {
    if (this.done || this.loading) return { items: [], done: true };
    this.loading = true;
    try {
      if (this.scope.q) {
        const all = await this._loadCanonicalSearchSet();
        const start = this.items.length;
        const pageItems = all.slice(start, start + this.pageSize);
        this.items.push(...pageItems);
        this.total = all.length;
        this.done = this.items.length >= all.length;
        this.cursor = pageItems.length
          ? (pageItems[pageItems.length - 1]._id || pageItems[pageItems.length - 1].curation_id)
          : null;
        return { items: pageItems, done: this.done, total: this.total };
      }

      const { items, total } = await this._fetch(this.cursor);
      if (total > 0 && this.total <= 0) {
        this.total = total;
      }
      if (items.length) {
        this.cursor = items[items.length - 1]._id || items[items.length - 1].curation_id;
      }
      if (items.length === 0) {
        this.done = true;
      }

      this.items.push(...items);
      return { items, done: this.done };
    } finally {
      this.loading = false;
    }
  }

  async openPage(pageNumber) {
    if (this.loading) return { items: [], done: true };
    this.loading = true;
    try {
      if (this.scope.q) {
        const all = await this._loadCanonicalSearchSet();
        const start = pageNumber * this.pageSize;
        const items = all.slice(start, start + this.pageSize);
        this.items = items;
        this.total = all.length;
        this.cursor = items.length
          ? (items[items.length - 1]._id || items[items.length - 1].curation_id)
          : null;
        this.done = start + items.length >= all.length;
        return { items, done: this.done, total: this.total };
      }

      const params = { ...this._params(null), offset: pageNumber * this.pageSize };
      delete params.after_id;
      const resp = await this.apiService.listCurations(params);
      const items = resp.items || [];

      if (resp.total > 0) {
        this.total = resp.total;
      }

      this.cursor = items.length
        ? (items[items.length - 1]._id || items[items.length - 1].curation_id)
        : null;
      this.items = items;
      this.done = items.length < this.pageSize;
      return { items, done: this.done, total: this.total };
    } finally {
      this.loading = false;
    }
  }

  async peekPage(pageNumber) {
    if (this.loading) return [];
    if (this.scope.q) {
      const all = await this._loadCanonicalSearchSet();
      const start = pageNumber * this.pageSize;
      return all.slice(start, start + this.pageSize);
    }

    const params = { ...this._params(null), offset: pageNumber * this.pageSize };
    delete params.after_id;
    const resp = await this.apiService.listCurations(params);
    return resp.items || [];
  }
}

if (typeof window !== 'undefined') { window.CurationBrowser = CurationBrowser; }
