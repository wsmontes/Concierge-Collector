// scripts/services/curationBrowser.js
class CurationBrowser {
  constructor({ apiService, cache, hydrator, pageSize = 25 } = {}) {
    this.apiService = apiService;
    this.cache = cache;
    this.hydrator = hydrator;
    this.pageSize = pageSize;
    this.scope = {};
    this.cursor = null;
    this.done = false;
    this._prefetched = null;
  }

  openScope({ curatorId = null, status = null, city = null, type = null, q = null } = {}) {
    this.scope = { curatorId, status, city, type, q };
    this.cursor = null;
    this.done = false;
    this._prefetched = null;
  }

  _params(afterId) {
    const p = { limit: this.pageSize };
    if (afterId != null) p.after_id = afterId;
    if (this.scope.curatorId) p.curator_id = this.scope.curatorId;
    if (this.scope.status) p.status = this.scope.status;
    if (this.scope.city) p.city = this.scope.city;
    if (this.scope.type) p.type = this.scope.type;
    if (this.scope.q) p.q = this.scope.q;
    return p;
  }

  async _fetch(afterId) {
    const resp = await this.apiService.listCurations(this._params(afterId));
    return resp.items || [];
  }

  async _ingest(items) {
    if (!items.length) return;
    await this.cache.putCurations(items);
    this.hydrator.enqueue(items.map(i => i.entity_id).filter(Boolean))?.catch?.(() => {});
  }

  async nextPage() {
    if (this.done) return { items: [], done: true };
    let items;
    if (this._prefetched && this._prefetched.forCursor === this.cursor) {
      items = this._prefetched.items;
      this._prefetched = null;
    } else {
      this._prefetched = null; // descarta prefetch obsoleto
      items = await this._fetch(this.cursor);
      await this._ingest(items);
    }

    if (items.length) this.cursor = items[items.length - 1].id;
    if (items.length < this.pageSize) this.done = true;

    if (!this.done) {
      const forCursor = this.cursor;
      Promise.resolve().then(async () => {
        try {
          const next = await this._fetch(forCursor);
          if (this.cursor === forCursor) { // ainda relevante?
            await this._ingest(next);
            this._prefetched = { forCursor, items: next };
          }
        } catch (_) {}
      });
    }
    return { items, done: this.done };
  }
}

export { CurationBrowser };
