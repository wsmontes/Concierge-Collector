/**
 * File: entityBrowser.js
 * Purpose: Navegação paginada (cursor/offset) sobre entities do servidor
 * Dependencies: ApiService (injetado)
 *
 * Main Responsibilities:
 * - Manter scope (filtros), cursor e página atual da listagem de entities
 * - Espelhar o CurationBrowser: o acervo (~21k entities) NUNCA é baixado
 *   inteiro — cada página traz só 25 entities do servidor
 * - openPage (offset) para prev/next; nextPage (cursor) para scroll infinito
 */
class EntityBrowser {
  constructor({ apiService, pageSize = 25 } = {}) {
    this.apiService = apiService;
    this.pageSize = pageSize;
    this.scope = {};
    this.cursor = null;
    this.done = false;
    this.loading = false;
    this.items = [];
    this.total = -1; // -1 = desconhecido (modo cursor nas páginas seguintes)
  }

  openScope({ type = null, city = null, q = null } = {}) {
    if (this._scopeChanged({ type, city, q })) {
      this.cursor = null;
      this.done = false;
      this.items = [];
      this.total = -1;
    }
    this.scope = { type, city, q };
  }

  _scopeChanged(next) {
    const prev = this.scope;
    return prev.type !== next.type
      || prev.city !== next.city
      || prev.q !== next.q;
  }

  _params(afterId) {
    const p = { limit: this.pageSize };
    if (afterId != null) p.after_id = afterId;
    if (this.scope.type) p.type = this.scope.type;
    if (this.scope.city) p.city = this.scope.city;
    if (this.scope.q) p.q = this.scope.q;
    return p;
  }

  async _fetch(afterId) {
    const resp = await this.apiService.listEntities(this._params(afterId));
    return { items: resp.items || [], total: resp.total };
  }

  async nextPage() {
    if (this.done || this.loading) return { items: [], done: true };
    this.loading = true;
    try {
      const { items, total } = await this._fetch(this.cursor);

      // Total real só vem na primeira página (modo cursor)
      if (total > 0 && this.total <= 0) {
        this.total = total;
      }

      if (!items || items.length === 0) {
        this.done = true;
        return { items: [], done: true };
      }

      // Cursor = último id recebido (o backend ordena por _id)
      this.cursor = items[items.length - 1]?._id || items[items.length - 1]?.entity_id || this.cursor;
      this.items.push(...items);
      return { items, done: false };
    } finally {
      this.loading = false;
    }
  }

  /**
   * Busca uma página específica por offset (prev/next). SUBSTITUI
   * this.items — o cursor não serve para voltar páginas.
   * @param {number} pageNumber - Índice zero-based da página
   */
  async openPage(pageNumber) {
    const params = { ...this._params(null), offset: pageNumber * this.pageSize };
    delete params.after_id;
    const resp = await this.apiService.listEntities(params);
    const items = resp.items || [];
    this.items = items;
    // Offset mode sempre devolve o total real
    if (resp.total > 0) {
      this.total = resp.total;
    }
    this.cursor = null;
    this.done = false;
    return { items, total: resp.total };
  }
}

// Classe disponível para o main.js instanciar (mesmo contrato do
// CurationBrowser: main.js lê window.EntityBrowser como CLASSE e a
// substitui pela instância)
if (typeof window !== 'undefined' && !window.EntityBrowser) {
  window.EntityBrowser = EntityBrowser;
}
