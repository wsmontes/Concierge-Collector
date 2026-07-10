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

  openScope({ curatorId = null, status = null } = {}) {
    this.scope = { curatorId, status };
    this.cursor = null;
    this.done = false;
    this._prefetched = null;
  }

  _params(afterId) {
    const p = { limit: this.pageSize };
    if (afterId != null) p.after_id = afterId;
    if (this.scope.curatorId) p.curator_id = this.scope.curatorId;
    if (this.scope.status) p.status = this.scope.status;
    return p;
  }

  async _fetch(afterId) {
    const resp = await this.apiService.listCurations(this._params(afterId));
    return resp.items || [];
  }

  async _ingest(items) {
    if (!items.length) return;
    await this.cache.putCurations(items);
    this.hydrator.enqueue(items.map(i => i.entity_id).filter(Boolean));
  }

  async nextPage() {
    if (this.done) return { items: [], done: true };
    let items;
    if (this._prefetched) { items = this._prefetched; this._prefetched = null; }
    else { items = await this._fetch(this.cursor); await this._ingest(items); }

    if (items.length) this.cursor = items[items.length - 1].id;
    if (items.length < this.pageSize) this.done = true;

    // prefetch da próxima página (background), sem bloquear o retorno
    if (!this.done) {
      Promise.resolve().then(async () => {
        try { const next = await this._fetch(this.cursor); await this._ingest(next); this._prefetched = next; } catch (_) {}
      });
    }
    return { items, done: this.done };
  }
}

export { CurationBrowser };
