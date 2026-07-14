// scripts/services/curationBrowser.js
class CurationBrowser {
  constructor({ apiService, pageSize = 25 } = {}) {
    this.apiService = apiService;
    this.pageSize = pageSize;
    this.scope = {};
    this.cursor = null;
    this.done = false;
    this.loading = false;
    this.items = [];
  }

  openScope({ curatorId = null, status = null, city = null, type = null, q = null } = {}) {
    // Only reset if the scope actually changed
    if (this._scopeChanged({ curatorId, status, city, type, q })) {
      this.cursor = null;
      this.done = false;
      this.items = [];
    }
    this.scope = { curatorId, status, city, type, q };
  }

  _scopeChanged(next) {
    const prev = this.scope;
    return prev.curatorId !== next.curatorId
      || prev.status !== next.status
      || prev.city !== next.city
      || prev.type !== next.type
      || prev.q !== next.q;
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

  async nextPage() {
    if (this.done || this.loading) return { items: [], done: true };
    this.loading = true;
    try {
      const items = await this._fetch(this.cursor);

      if (items.length) {
        this.cursor = items[items.length - 1]._id || items[items.length - 1].curation_id;
      }
      if (items.length < this.pageSize) {
        this.done = true;
      }

      this.items.push(...items);
      return { items, done: this.done };
    } finally {
      this.loading = false;
    }
  }
}

if (typeof window !== 'undefined') { window.CurationBrowser = CurationBrowser; }
