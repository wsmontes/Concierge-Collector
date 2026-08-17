/**
 * File: curationBrowser.js
 * Purpose: Navegação paginada (cursor) sobre curations do servidor
 * Dependencies: ApiService (injetado), AppConfig (endpoints)
 *
 * Main Responsibilities:
 * - Manter scope (filtros), cursor e página atual da listagem de curations
 * - Pageamento por cursor com fallback de total desconhecido
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
    this.total = -1; // -1 = unknown (cursor mode on subsequent pages)
  }

  openScope({ curatorId = null, status = null, city = null, type = null, q = null, unlinked = false, createdAfter = null } = {}) {
    if (this._scopeChanged({ curatorId, status, city, type, q, unlinked, createdAfter })) {
      this.cursor = null;
      this.done = false;
      this.items = [];
      this.total = -1;
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
    // Ordenação padrão: últimas modificações primeiro (server-side —
    // a paginação offset depende da ordem estável do servidor)
    p.sort_by = this.scope.sortBy || 'updated_at';
    p.sort_order = this.scope.sortOrder || 'desc';
    if (this.scope.curatorId) p.curator_id = this.scope.curatorId;
    // 'all' é o placeholder dos selects intocados — NUNCA vira filtro
    // (mesmo guard do entityBrowser; latente: mudar outro filtro com o
    // select em 'all' enviava type=all e zerava a busca server-side)
    if (this.scope.status && this.scope.status !== 'all') p.status = this.scope.status;
    if (this.scope.city) p.city = this.scope.city;
    if (this.scope.type && this.scope.type !== 'all') p.type = this.scope.type;
    if (this.scope.q) p.q = this.scope.q;
    // Saved views (auditoria UX, ponto 20): órfãs e janela de criação
    if (this.scope.unlinked) p.unlinked = true;
    if (this.scope.createdAfter) p.created_after = this.scope.createdAfter;
    return p;
  }

  async _fetch(afterId) {
    const resp = await this.apiService.listCurations(this._params(afterId));
    return { items: resp.items || [], total: resp.total };
  }

  async nextPage() {
    if (this.done || this.loading) return { items: [], done: true };
    this.loading = true;
    try {
      const { items, total } = await this._fetch(this.cursor);

      // Capture total from first page (subsequent pages return -1 in cursor mode)
      if (total > 0 && this.total <= 0) {
        this.total = total;
      }

      if (items.length) {
        this.cursor = items[items.length - 1]._id || items[items.length - 1].curation_id;
      }
      // Página curta NÃO encerra: _ids de tipos mistos ordenam em segmentos
      // (string → ObjectId no Mongo) e a cauda curta de um segmento é seguida
      // pelo próximo. Só página VAZIA termina (custo: 1 request extra).
      if (items.length === 0) {
        this.done = true;
      }

      this.items.push(...items);
      return { items, done: this.done };
    } finally {
      this.loading = false;
    }
  }

  /**
   * Fetch a specific page via offset (prev/next navigation — the cursor
   * mode can only go forward). Replaces this.items with that single page.
   * @param {number} pageNumber - Zero-based page index
   */
  async openPage(pageNumber) {
    if (this.loading) return { items: [], done: true };
    this.loading = true;
    try {
      const params = { ...this._params(null), offset: pageNumber * this.pageSize };
      delete params.after_id;
      const resp = await this.apiService.listCurations(params);
      const items = resp.items || [];

      // Offset mode always returns the real total
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

  /**
   * Espia uma página via offset SEM tocar o estado (prefetch do véu OG
   * — padrão ImagePrefetcher do feedmine): openPage SUBSTITUI items/
   * cursor; o peek só devolve os itens da página.
   * @param {number} pageNumber - Zero-based page index
   * @returns {Promise<Array>} Itens da página (sem efeitos colaterais)
   */
  async peekPage(pageNumber) {
    if (this.loading) return [];
    const params = { ...this._params(null), offset: pageNumber * this.pageSize };
    delete params.after_id;
    const resp = await this.apiService.listCurations(params);
    return resp.items || [];
  }
}

if (typeof window !== 'undefined') { window.CurationBrowser = CurationBrowser; }
