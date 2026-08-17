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
        // v2: namespace novo (ago/2026) — entradas da v1 não têm TTL e
        // ficariam servindo imagens antigas (brancos/ícones) para sempre
        this._cacheName = 'og-images-v2';
        // TTL client-side: o ranking SERVER-SIDE muda com as heurísticas
        // (1h no servidor) — sem TTL o blob velho venceria o ranking novo
        this._clientCacheTtlMs = 24 * 3600 * 1000;
        // prefetch da próxima página (padrão ImagePrefetcher do feedmine)
        this._prefetchedPages = new Set();
        this._prefetchTimer = null;
        // Escalonador de downloads (ago/2026): sem cap, cada página
        // visitada disparava ~25 downloads em paralelo e SEGURAVA as 6
        // conexões do navegador — a paginação ficava travada atrás das
        // imagens. Fila com prioridade avaliada NA HORA do pop:
        //   0 = card visível no viewport (página atual, acima da dobra)
        //   1 = card no DOM (página atual, abaixo da dobra)
        //   2 = card fora do DOM (páginas já navegadas — populam depois)
        //   3 = prefetch da próxima página (último da fila)
        this._waiting = [];
        this._active = 0;
        this._maxConcurrent = 4; // deixa folga para API/sync na pool do browser
        // Hard reset de imagens (Cmd+Shift+R): o keydown é visto antes
        // do reload nos browsers principais; a flag vira UMA limpeza do
        // Cache Storage no próximo init — reload normal NÃO toca o cache
        this._flushCacheOnInit = false;
        if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('og-images-hard-reset') === '1') {
            sessionStorage.removeItem('og-images-hard-reset');
            this._flushCacheOnInit = true;
        }
    }

    /**
     * Inicializa o módulo: observa o DOM por cards com data-og-source.
     */
    async init() {
        if (!window.ApiService) {
            this.log.warn('ApiService indisponível — véu OG desativado');
            return;
        }

        // Detecta o ATALHO do hard reset para o PRÓXIMO load (o reload
        // deste atalho acontece depois do keydown; a flag sobrevive no
        // sessionStorage, que persiste entre reloads da mesma aba)
        document.addEventListener('keydown', (event) => {
            if ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === 'r' || event.key === 'R')) {
                try {
                    sessionStorage.setItem('og-images-hard-reset', '1');
                } catch (error) {
                    this.log.debug('hard-reset flag falhou:', error);
                }
            }
        });

        // Hard reset pedido no load anterior: limpa o cache UMA vez —
        // as imagens serão repopuladas pelo ranking atual do servidor
        if (this._flushCacheOnInit && window.caches) {
            this._flushCacheOnInit = false;
            try {
                await caches.delete(this._cacheName);
                this.log.debug('Cache de imagens limpo por hard reset');
            } catch (error) {
                this.log.debug('limpeza do cache falhou:', error);
            }
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

        // Enfileira — o ESCALONADOR decide a ordem (viewport > página
        // atual > páginas já navegadas > prefetch) e limita a
        // concorrência; a resolução em si é deduplicada por chave.
        this._waiting.push({
            card: card,
            key: key,
            start: () => {
                let promise = this._pending.get(key);
                if (!promise) {
                    promise = entityId
                        ? this._resolveEntityImage(entityId, rank, url, placeId, key)
                        : this._resolve(url, placeId, key);
                    this._pending.set(key, promise);
                }
                return promise;
            }
        });
        this._drain();

        // Prefetch da próxima página (debounce): depois que a página
        // atual terminou de enfileirar, pré-resolve as imagens da página
        // seguinte — o clique em "next" encontra o véu pronto.
        clearTimeout(this._prefetchTimer);
        this._prefetchTimer = setTimeout(() => this._prefetchNextPage(), 1500);
    }

    /**
     * Prioridade do item NA HORA do pop (não no enfileiramento):
     * a troca de página remove os cards antigos do DOM — eles afundam
     * para a prioridade 2 sozinhos, e a página nova assume a frente.
     * @param {HTMLElement|null} card - Card alvo (null = prefetch)
     */
    _cardPriority(card) {
        if (!card || typeof card.isConnected === 'undefined') return 3;
        if (!card.isConnected) return 2;
        const rect = card.getBoundingClientRect();
        if (rect && rect.top < window.innerHeight && rect.bottom > 0) return 0;
        return 1;
    }

    /**
     * Escalonador: mantém até _maxConcurrent resoluções em voo e
     * escolhe sempre o item de MAIOR prioridade entre os enfileirados
     * (viewport > página atual > páginas navegadas > prefetch).
     */
    _drain() {
        while (this._active < this._maxConcurrent && this._waiting.length > 0) {
            let bestIndex = 0;
            let bestPriority = Infinity;
            for (let i = 0; i < this._waiting.length; i++) {
                const priority = this._cardPriority(this._waiting[i].card);
                if (priority < bestPriority) {
                    bestPriority = priority;
                    bestIndex = i;
                }
            }
            const [item] = this._waiting.splice(bestIndex, 1);
            this._active++;
            item.start()
                .then((objectUrl) => {
                    if (!item.card) return; // prefetch: só aquece o cache
                    if (!objectUrl) {
                        // sem imagem em nenhuma fonte — véu de fallback
                        this._applyFallback(item.card);
                        return;
                    }
                    this._applyVeil(item.card, objectUrl);
                })
                .catch(() => {
                    if (!item.card) return;
                    // falha de rede/api — véu de fallback, card nunca fica cru
                    this._applyFallback(item.card);
                    if (item.card.dataset) {
                        item.card.dataset.ogFailed = '1';
                    }
                })
                .finally(() => {
                    this._active--;
                    this._drain();
                });
        }
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
        if (cached === false) return null; // negativo fresco: sem rede
        if (cached) return cached;

        // 2) Endpoint ranqueado por entity (rank 0 = hero default;
        //    rank ≥1 = escolha do concierge no editor)
        let entityDefinitive = false;
        try {
            const response = await window.ApiService.request(
                'GET',
                `/entities/${encodeURIComponent(entityId)}/image?rank=${rank}`,
                { silent: true } // entity local/pending 404 é esperada — sem log de erro
            );
            if (response && response.ok) {
                const blob = await response.blob();
                if (blob && blob.size > 0) {
                    await this._writeCache(key, blob);
                    return URL.createObjectURL(blob);
                }
                entityDefinitive = true; // 200 mas vazio: sem imagem
            } else if (response) {
                entityDefinitive = true; // 404/400 do servidor: sem imagem
            }
        } catch (error) {
            // erro de REDE não é definitivo — não grava negativo
            this.log.debug(`imagem por entity falhou para ${entityId}:`, error);
        }

        // 3) Fallback legado por URL (entity fora do servidor ainda)
        if (!url && !placeId) {
            // servidor sem imagem E sem fonte legada → negativo persistido
            // (o reload não re-dispareava mais o 404 desta chave)
            if (entityDefinitive) await this._writeNoImage(key);
            return null;
        }
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
                    if (key && !this._pending.has(key) && !this._waiting.some((w) => w.key === key)) {
                        // Prefetch entra no escalonador na prioridade MAIS
                        // baixa — nunca disputa conexão com a página atual
                        this._waiting.push({
                            card: null,
                            key: key,
                            start: () => {
                                let promise = this._pending.get(key);
                                if (!promise) {
                                    promise = entityId
                                        ? this._resolveEntityImage(entityId, 0, url, placeId, key)
                                        : this._resolve(url, placeId, key);
                                    this._pending.set(key, promise);
                                }
                                return promise;
                            }
                        });
                        this._drain();
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
        if (cached === false) return null; // negativo fresco: sem rede
        if (cached) return cached;

        // 2) API — devolve o JPEG redimensionado; o backend tenta
        //    og:image e cai pra foto do Places quando place_id vem junto
        const params = new URLSearchParams();
        if (url) params.set('url', url);
        if (placeId) params.set('place_id', placeId);
        try {
            const response = await window.ApiService.request(
                'GET',
                `ogImage?${params.toString()}`,
                { silent: true } // falha esperada (sem og:meta) — sem log de erro
            );
            if (!response || !response.ok) {
                await this._writeNoImage(key); // 404/400 definitivo
                return null;
            }
            const blob = await response.blob();
            if (!blob || blob.size === 0) {
                await this._writeNoImage(key);
                return null;
            }

            await this._writeCache(key, blob);
            return URL.createObjectURL(blob);
        } catch (error) {
            // erro de REDE não é definitivo — não grava negativo
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
            // TTL client-side: entradas antigas não podem vencer um
            // ranking server-side novo (caso Ryo/Arturito — o navegador
            // guardava o blob branco/ícone com a mesma chave). Entradas
            // legadas sem o header ficam como "frescas" (compat).
            const headers = hit.headers;
            const cachedAt = Number(headers && headers.get ? headers.get('x-cached-at') : 0) || 0;
            if (cachedAt && Date.now() - cachedAt > this._clientCacheTtlMs) {
                await cache.delete(url);
                return null;
            }
            // Negativo persistido (404/400 já visto nesta chave): false
            // sinaliza "sem imagem conhecida" SEM refazer a rede — sem
            // isso cada reload re-dispareava a enxurrada de 404 (2026-08-16)
            const noImage = !!(headers && headers.get && headers.get('x-no-image'));
            if (noImage) return false;
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
            await cache.put(
                url,
                new Response(blob, {
                    headers: {
                        'Content-Type': blob.type,
                        'x-cached-at': String(Date.now())
                    }
                })
            );
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
     * Persiste um NEGATIVO no Cache Storage: esta chave já foi resolvida
     * e NÃO tem imagem (404/400 definitivo do servidor). Com o negativo,
     * o próximo load do card pula a rede direto para o fallback — sem a
     * enxurrada de requests 404 no console a cada reload. Falha de rede
     * NÃO grava negativo: offline não pode congelar o card por 24h.
     * @param {string} url - chave do cache
     */
    async _writeNoImage(url) {
        if (!window.caches) return;
        try {
            const cache = await caches.open(this._cacheName);
            await cache.put(
                url,
                new Response('', {
                    headers: {
                        'Content-Type': 'text/plain',
                        'x-no-image': '1',
                        'x-cached-at': String(Date.now())
                    }
                })
            );
        } catch (error) {
            this.log.debug('escrita do negativo no Cache Storage falhou:', error);
        }
    }

    /**
     * Hard reset manual de imagens (menu do usuário — o equivalente
     * mobile do Cmd+Shift+R): apaga o namespace do Cache Storage; as
     * resoluções em voo terminam e regravam conteúdo FRESCO. O caller
     * re-renderiza a tela para os cards re-enfileirarem.
     */
    async clearImageCache() {
        if (!window.caches) return;
        try {
            await caches.delete(this._cacheName);
            this.log.debug('Cache de imagens limpo manualmente');
        } catch (error) {
            this.log.debug('limpeza manual do cache falhou:', error);
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
