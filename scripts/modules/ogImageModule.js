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
 * Nos cards da coleção (redesign ago/2026) o alvo é a THUMBNAIL
 * explícita (.collection-card__thumb): o módulo preenche o src do img
 * e marca .is-loaded (fade); o fallback de gradiente pedra do markup
 * cobre os cards sem imagem. O véu continua suportado para o herói
 * dos detail sheets.
 *
 * Resolução (ago/2026): cards com data-entity-id usam o hero
 * RANQUEADO server-side (GET /entities/{id}/image?rank=0 — o servidor
 * resolve website/place_id da própria entity, sem URLs do cliente);
 * 404/erro (entity local/pending) cai para o caminho legado por URL.
 * Cache Storage e dedupe continuam, com chaves entity:<id>.
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

        // Cards já renderizados antes do init. ATENÇÃO: o seletor inclui
        // data-entity-id — um card cujo registro local não tem website
        // (IndexedDB desatualizado) NÃO ganha data-og-source, mas o
        // servidor resolve as fontes pela entity; sem o seletor, esses
        // cards nunca entravam na fila (galeria funcionava, card não).
        const IMAGE_SLOTS = '[data-og-source], [data-og-place-id], [data-entity-id]';
        document.querySelectorAll(IMAGE_SLOTS).forEach((card) => this._queue(card));

        // Cards renderizados depois (listas/paginação/import)
        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.matches && node.matches(IMAGE_SLOTS)) {
                        this._queue(node);
                    }
                    if (node.querySelectorAll) {
                        node.querySelectorAll(IMAGE_SLOTS).forEach((card) => this._queue(card));
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
        // Dois slots de imagem coexistem: a thumbnail explícita dos
        // cards da coleção (.collection-card__thumb — img com lazy
        // loading) e o véu legado (.card-og-veil — herói dos detail
        // sheets). Sem nenhum dos dois, não há o que pintar.
        const hasThumb = !!card.querySelector('.collection-card__thumb');
        const hasVeil = !!card.querySelector('.card-og-veil');
        if (!hasThumb && !hasVeil) return;

        const entityId = (card.dataset && card.dataset.entityId) || '';
        const url = (card.dataset && card.dataset.ogSource) || '';
        const placeId = (card.dataset && card.dataset.ogPlaceId) || '';
        // Hero escolhido pelo concierge no editor (data.image_rank)
        const rank = parseInt(card.dataset && card.dataset.imageRank, 10) || 0;
        card.dataset.ogResolved = '1'; // processado — nunca duas vezes

        // Sem NENHUMA fonte (nem entity — o servidor resolve as fontes
        // pela entity quando o card tem data-entity-id): no card com
        // thumb o placeholder do markup (gradiente pedra + ícone do
        // tipo, sempre renderizado sob o img vazio) já é o estado final
        // — padrão feedmine "cards resolvidos antes de aparecer", sem
        // rede. O véu legado recebe a classe de fallback como antes.
        if (!entityId && !url && !placeId) {
            if (!hasThumb) {
                this._applyFallback(card);
            }
            return;
        }

        // chave de dedupe/cache: entity (rank-aware — o hero escolhido
        // não pode colidir com o default) ou site/lugar no legado
        const key = entityId ? `entity:${entityId}:rank:${rank}` : (url || `place:${placeId}`);

        let promise = this._pending.get(key);
        if (!promise) {
            promise = entityId
                ? this._resolveEntityImage(entityId, rank, url, placeId, key)
                : this._resolve(url, placeId, key);
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
     * Resolve a imagem de um card COM data-entity-id: hero ranqueado
     * server-side via GET /entities/{id}/image?rank=0 (o ApiService
     * anexa o JWT). Entities locais/pending que ainda não existem no
     * servidor (404/erro) caem para o caminho legado por URL — o card
     * nunca perde imagem por identidade.
     * @param {string} entityId - entity_id do card
     * @param {string} url - website do card (fallback legado)
     * @param {string} placeId - place_id do card (fallback legado)
     * @param {string} key - chave de cache/dedupe (entity:<id>)
     * @returns {Promise<string|null>} objectURL ou null
     */
    async _resolveEntityImage(entityId, rank, url, placeId, key) {
        // 1) Cache Storage (persistência client-side — offline incluído)
        const cached = await this._readCache(key);
        if (cached) return cached;

        // 2) Endpoint ranqueado por entity (rank 0 = hero default;
        //    rank ≥1 = escolha do concierge no editor)
        try {
            const response = await window.ApiService.request(
                'GET',
                `/entities/${encodeURIComponent(entityId)}/image?rank=${rank}`
            );
            if (response && response.ok) {
                const blob = await response.blob();
                if (blob && blob.size > 0) {
                    await this._writeCache(key, blob);
                    return URL.createObjectURL(blob);
                }
            }
        } catch (error) {
            this.log.debug(`imagem por entity falhou para ${entityId}:`, error);
        }

        // 3) Fallback legado por URL (entity fora do servidor ainda)
        if (!url && !placeId) return null;
        try {
            return await this._resolve(url, placeId, key);
        } catch (error) {
            this.log.debug(`og-image legado falhou para ${key}:`, error);
            return null;
        }
    }

    /**
     * Pré-resolve as imagens OG da PRÓXIMA página dos browsers
     * (CurationBrowser/EntityBrowser) via peekPage — espia SEM avançar
     * o cursor (openPage/nextPage mutariam a paginação). Padrão
     * ImagePrefetcher do feedmine. Items com entity_id pré-resolvem pelo
     * hero ranqueado da entity; sem entity_id, pelo caminho legado.
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
                    const placeId = d.place_id || d.google_place_id || item.place_id || '';
                    const entityId = item.entity_id || d.entity_id || '';
                    const key = entityId ? `entity:${entityId}:rank:0` : (url || (placeId ? `place:${placeId}` : ''));
                    if (key && !this._pending.has(key)) {
                        const promise = entityId
                            ? this._resolveEntityImage(entityId, 0, url, placeId, key)
                            : this._resolve(url, placeId, key);
                        this._pending.set(key, promise);
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
     * Aplica a imagem no card: thumbnail (img com src) quando o card da
     * coleção tem o slot novo; véu legado (background + classe --visible)
     * nos detail sheets.
     * @param {HTMLElement} card - Card alvo
     * @param {string} objectUrl - objectURL gerado pelo módulo (blob:)
     */
    _applyVeil(card, objectUrl) {
        // objectURLs são gerados por URL.createObjectURL — nunca entram
        // markup alheio; o teste de sanidade só afasta lixo.
        if (typeof objectUrl !== 'string' || !objectUrl.startsWith('blob:')) return;

        const thumb = card.querySelector('.collection-card__thumb');
        if (thumb) {
            thumb.src = objectUrl;
            thumb.classList.add('is-loaded');
            return;
        }

        const veil = card.querySelector('.card-og-veil');
        if (!veil) return;
        veil.style.backgroundImage = `url("${objectUrl}")`;
        veil.classList.add('card-og-veil--visible');
    }
});
