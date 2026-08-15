/**
 * File: ogImageModule.js
 * Purpose: Véu de imagem OG nos cards de entidades e curations linkadas
 * Dependencies: ApiService, Logger, ModuleWrapper
 *
 * Main Responsibilities:
 * - Observa cards marcados com [data-og-source] (website do restaurante,
 *   gravado pelo CardFactory) e resolve a imagem OG em real-time via
 *   GET /api/v3/og-image (fetch server-side — o browser sozinho esbarra
 *   em CORS). O backend devolve o JPEG JÁ redimensionado (~768px).
 * - Persistência client-side em Cache Storage ('og-images-v1'): cache
 *   quente dispensa a rede em loads seguintes e funciona offline.
 *   (Cache Storage em vez de IndexedDB: guarda o blob/Response direto,
 *   sem bump de schema do banco local — IndexedDB exigiria migração.)
 * - Dedupe por URL: N cards do mesmo site compartilham uma única busca
 *   (promise cache do módulo) e o mesmo objectURL.
 * - Falha silenciosa (404/offline/sem imagem) = card limpo, sem retry.
 *
 * O véu em si é estilizado em components.css (.card-og-veil): degradê
 * topo→transparente com wash branco pra legibilidade, opacidade baixa.
 */

const OgImageModule = ModuleWrapper.defineClass('OgImageModule', class {
    constructor() {
        this.log = Logger.module('OgImageModule');
        this.observer = null;
        // url do site -> Promise<objectURL|null> (dedupe de cards do mesmo site)
        this._pending = new Map();
        this._cacheName = 'og-images-v1';
        // prefetch da próxima página (padrão ImagePrefetcher do feedmine)
        this._prefetchedPages = new Set();
        this._prefetchTimer = null;
    }

    /**
     * Inicializa o módulo: observa o DOM por cards com data-og-source.
     */
    async init() {
        if (!window.ApiService) {
            this.log.warn('ApiService indisponível — véu OG desativado');
            return;
        }

        // Cards já renderizados antes do init
        document.querySelectorAll('[data-og-source]').forEach((card) => this._queue(card));

        // Cards renderizados depois (listas/paginação/import)
        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.matches && node.matches('[data-og-source]')) {
                        this._queue(node);
                    }
                    if (node.querySelectorAll) {
                        node.querySelectorAll('[data-og-source]').forEach((card) => this._queue(card));
                    }
                }
            }
        });
        this.observer.observe(document.body, { childList: true, subtree: true });
        this.log.debug('Observer de data-og-source ativo');
    }

    /**
     * Enfileira um card para receber o véu (no-op se já processado).
     * @param {HTMLElement} card - Card com data-og-source e/ou data-og-place-id
     */
    _queue(card) {
        if (card.dataset && (card.dataset.ogResolved || card.dataset.ogFailed)) return;
        if (!card.querySelector('.card-og-veil')) return; // card sem slot de véu

        const url = (card.dataset && card.dataset.ogSource) || '';
        const placeId = (card.dataset && card.dataset.ogPlaceId) || '';
        card.dataset.ogResolved = '1'; // processado — nunca duas vezes

        // Sem NENHUMA fonte: estado final decidido já no render (padrão
        // feedmine "cards resolvidos antes de aparecer") — véu de
        // fallback no tom do status, sem rede.
        if (!url && !placeId) {
            this._applyFallback(card);
            return;
        }

        // chave de dedupe/cache: site quando existe; senão o lugar
        const key = url || `place:${placeId}`;

        let promise = this._pending.get(key);
        if (!promise) {
            promise = this._resolve(url, placeId, key);
            this._pending.set(key, promise);
        }
        promise.then((objectUrl) => {
            if (!objectUrl) {
                // sem imagem em nenhuma fonte — véu de fallback
                this._applyFallback(card);
                return;
            }
            this._applyVeil(card, objectUrl);
        }).catch(() => {
            // falha de rede/api — véu de fallback, card nunca fica cru
            this._applyFallback(card);
            card.dataset.ogFailed = '1';
        });

        // Prefetch da próxima página (debounce): depois que a página
        // atual terminou de enfileirar, pré-resolve as imagens da página
        // seguinte — o clique em "next" encontra o véu pronto.
        clearTimeout(this._prefetchTimer);
        this._prefetchTimer = setTimeout(() => this._prefetchNextPage(), 1500);
    }

    /**
     * Pré-resolve as imagens OG da PRÓXIMA página dos browsers
     * (CurationBrowser/EntityBrowser) via peekPage — espia SEM avançar
     * o cursor (openPage/nextPage mutariam a paginação). Padrão
     * ImagePrefetcher do feedmine.
     */
    _prefetchNextPage() {
        const targets = [
            {
                browser: window.CurationBrowser,
                getPage: () => window.uiManager?.curationPagination?.currentPage
            },
            {
                browser: window.EntityBrowser,
                getPage: () => window.uiManager?.entityPagination?.currentPage
            }
        ];

        for (const { browser, getPage } of targets) {
            if (!browser || typeof browser.peekPage !== 'function') continue;
            const currentPage = getPage && getPage();
            if (typeof currentPage !== 'number') continue;

            const pageKey = `${browser.constructor.name}:${currentPage + 1}`;
            if (this._prefetchedPages.has(pageKey)) continue;
            this._prefetchedPages.add(pageKey);

            browser.peekPage(currentPage + 1).then((items) => {
                for (const item of items || []) {
                    const d = item.data || {};
                    const url = d.contact?.website || d.contacts?.website || d.website || item.website || '';
                    const placeId = d.place_id || item.place_id || '';
                    const key = url || (placeId ? `place:${placeId}` : '');
                    if (key && !this._pending.has(key)) {
                        this._pending.set(key, this._resolve(url, placeId, key));
                    }
                }
            }).catch((error) => {
                this.log.debug(`prefetch da próxima página falhou (${browser.constructor.name}):`, error);
            });
        }
    }

    /**
     * Véu de fallback: gradiente suave no tom do status do card
     * (card-accent-* + CSS em components.css). Sem imagem, sem rede.
     * @param {HTMLElement} card - Card alvo
     */
    _applyFallback(card) {
        const veil = card.querySelector('.card-og-veil');
        if (!veil) return;
        veil.classList.add('card-og-veil--fallback');
    }

    /**
     * Resolve a imagem do card: Cache Storage primeiro, API depois.
     * @param {string} url - URL do site do restaurante ('' quando não há)
     * @param {string} placeId - Google place_id ('' quando não há)
     * @param {string} key - chave de cache/dedupe
     * @returns {Promise<string|null>} objectURL do blob ou null
     */
    async _resolve(url, placeId, key) {
        // 1) Cache Storage (persistência client-side — sem rede)
        const cached = await this._readCache(key);
        if (cached) return cached;

        // 2) API — devolve o JPEG redimensionado; o backend tenta
        //    og:image e cai pra foto do Places quando place_id vem junto
        const params = new URLSearchParams();
        if (url) params.set('url', url);
        if (placeId) params.set('place_id', placeId);
        try {
            const response = await window.ApiService.request(
                'GET',
                `ogImage?${params.toString()}`
            );
            if (!response || !response.ok) return null;
            const blob = await response.blob();
            if (!blob || blob.size === 0) return null;

            await this._writeCache(key, blob);
            return URL.createObjectURL(blob);
        } catch (error) {
            this.log.debug(`og-image falhou para ${key}:`, error);
            throw error;
        }
    }

    /**
     * Lê o blob persistido no Cache Storage (null sem hit/sem suporte).
     * @param {string} url - chave do cache (URL do site)
     * @returns {Promise<string|null>} objectURL ou null
     */
    async _readCache(url) {
        if (!window.caches) return null;
        try {
            const cache = await caches.open(this._cacheName);
            const hit = await cache.match(url);
            if (!hit) return null;
            const blob = await hit.blob();
            return blob && blob.size > 0 ? URL.createObjectURL(blob) : null;
        } catch (error) {
            this.log.debug('leitura do Cache Storage falhou:', error);
            return null;
        }
    }

    /**
     * Persiste o blob no Cache Storage (no-op sem suporte/em falha).
     * @param {string} url - chave do cache (URL do site)
     * @param {Blob} blob - imagem já redimensionada pelo backend
     */
    async _writeCache(url, blob) {
        if (!window.caches) return;
        try {
            const cache = await caches.open(this._cacheName);
            await cache.put(url, new Response(blob, { headers: { 'Content-Type': blob.type } }));
            // LRU manual: o browser decide a cota, mas ~200 imagens (60-120KB)
            // são suficientes para o acervo local — além disso, remove as
            // entradas mais antigas em ordem de inserção (feedmine
            // DiskImageCache tem política parecida).
            const keys = await cache.keys();
            if (keys.length > 200) {
                for (const stale of keys.slice(0, keys.length - 200)) {
                    await cache.delete(stale);
                }
            }
        } catch (error) {
            this.log.debug('escrita no Cache Storage falhou:', error);
        }
    }

    /**
     * Aplica o véu no card (classe --visible dispara o fade do CSS).
     * @param {HTMLElement} card - Card alvo
     * @param {string} objectUrl - objectURL gerado pelo módulo (blob:)
     */
    _applyVeil(card, objectUrl) {
        // objectURLs são gerados por URL.createObjectURL — nunca entram
        // markup alheio; o teste de sanidade só afasta lixo.
        if (typeof objectUrl !== 'string' || !objectUrl.startsWith('blob:')) return;
        const veil = card.querySelector('.card-og-veil');
        if (!veil) return;
        veil.style.backgroundImage = `url("${objectUrl}")`;
        veil.classList.add('card-og-veil--visible');
    }
});
