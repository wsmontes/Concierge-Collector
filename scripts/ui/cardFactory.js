/**
 * File: cardFactory.js
 * Purpose: Centralized UI card creation factory
 * Dependencies: None
 * 
 * Main Responsibilities:
 * - Single source of truth for all card designs
 * - Consistent visual styling across app
 * - Prevent duplication of card rendering logic
 * - Easy maintenance and updates
 */

const CardFactory = ModuleWrapper.defineClass('CardFactory', class {
    constructor() {
        this.log = Logger?.module('CardFactory') || console;
    }

    /**
     * Aplica (ou troca) a classe de accent de status na borda esquerda do card.
     * O estado do workflow (draft/linked/active/...) vira uma borda colorida
     * de 4px, escaneável sem ler o rodapé. Classes definidas em components.css.
     * @param {HTMLElement} card - Card já montado
     * @param {string} status - Estado atual (draft, linked, active, ...)
     */
    _applyStatusAccent(card, status) {
        const accents = {
            draft: 'card-accent-draft',
            linked: 'card-accent-linked',
            active: 'card-accent-active',
            archived: 'card-accent-archived',
            deleted: 'card-accent-deleted',
            done: 'card-accent-active',
            pending: 'card-accent-pending'
        };
        // Remove qualquer accent anterior antes de aplicar o novo
        card.classList.forEach(cls => {
            if (cls.startsWith('card-accent-')) card.classList.remove(cls);
        });
        card.classList.add(accents[status] || 'card-accent-archived');
    }

    /**
     * True quando o card é "novo" (criado/atualizado nas últimas 24h).
     * Tolerante aos shapes de timestamp dos dois formatos de entity.
     * @param {Object} entity - Entity do card
     * @returns {boolean}
     */
    _isRecentlyCreated(entity) {
        const raw =
            entity.createdAt ||
            entity.updatedAt ||
            entity.data?.createdAt ||
            entity.data?.updatedAt ||
            entity.data?.created_at ||
            entity.data?.updated_at;
        if (!raw) return false;
        const t = new Date(raw).getTime();
        if (isNaN(t)) return false;
        return Date.now() - t < 24 * 3600 * 1000;
    }

    /**
     * Create standardized entity card
     * @param {Object} entity - Entity data
     * @param {Object} options - Card options (size, variant, etc.)
     * @returns {HTMLElement} Card element
     */
    createEntityCard(entity, options = {}) {
        if (!entity) {
            console.error('[CardFactory] Cannot create card: entity is null/undefined');
            return this.createEmptyState({
                icon: 'error',
                title: 'Invalid entity',
                message: 'Entity data is missing'
            });
        }

        const {
            variant = 'default', // default, compact, detailed (API preservada)
            showActions = true,
            onClick = null,
            subtitleHtml = null,
            detailsHtml = '',
            showEntityActions = false,
            onEdit = null,
            onDetails = null,
            onSync = null,
            // 'card' = card inteiro clicável (entidades); 'name' = só o
            // nome é alvo de clique (curadoria — card não parece editável)
            clickTarget = 'card'
        } = options;

        const card = document.createElement('div');
        card.className = 'collection-card group';
        card.dataset.entityId = entity.entity_id;
        this._applyStatusAccent(card, entity.status || 'active');

        const name = entity.name || 'Unknown';
        const type = entity.type || 'restaurant';
        const typeIcon = this.getTypeIcon(type);

        // Extract city using robust method
        const city = this.extractCity(entity);
        const neighborhood = entity.data?.address?.neighborhood || entity.data?.location?.neighborhood || '';
        const country = entity.data?.address?.country || entity.data?.location?.country || '';
        const rating = entity.data?.attributes?.rating || entity.data?.rating || 0;
        const priceLevel = entity.data?.attributes?.price_level || entity.data?.price_level || 0;
        const cuisine = entity.data?.attributes?.cuisine || entity.data?.cuisine || [];
        // Tolerante aos dois shapes (v3 singular + bulk plural) — mesma
        // cadeia do extractEntityWebsite: sem isso, entities com
        // data.contacts.website ficavam sem data-og-source (sem foto)
        const website =
            entity.data?.contact?.website ||
            entity.data?.contacts?.website ||
            entity.data?.website ||
            entity?.website || '';

        // Thumbnail OG (ogImageModule resolve em real-time via
        // /api/v3/og-image e preenche .collection-card__thumb).
        // Fonte primária: website. Fallback de cobertura: place_id →
        // foto do Google Places (muitos sites não têm og:image).
        if (website) {
            card.dataset.ogSource = website;
        }
        // google_place_id é o shape de algumas entities bulk (37 no acervo
        // vivo têm SÓ esse campo) — mesma cadeia do detail sheet da entity
        const placeId = entity.data?.place_id || entity.data?.google_place_id || entity.place_id || '';
        if (placeId) {
            card.dataset.ogPlaceId = placeId;
        }

        // Hero escolhido pelo concierge no editor (data.image_rank ≥ 1):
        // o ogImageModule pede ?rank=<escolhido> em vez do hero default
        const imageRank = Number(entity.data?.image_rank) || 0;
        if (imageRank > 0) {
            card.dataset.imageRank = String(imageRank);
        }

        // Badge "novo" (padrão newBadge do feedmine): criado/atualizado
        // nas últimas 24h — ajuda o concierge a achar o que acabou de
        // entrar sem ler a lista inteira.
        const isNew = this._isRecentlyCreated(entity);

        // Get first cuisine type if available
        const cuisineType = Array.isArray(cuisine) && cuisine.length > 0 ? cuisine[0] : '';

        // Format location string
        let locationStr = city;
        if (neighborhood && neighborhood !== city) {
            locationStr = `${neighborhood}, ${city}`;
        }
        if (country && country !== city) {
            locationStr += ` • ${country}`;
        }

        // Price level indicator
        const priceIndicator = priceLevel > 0 ? '€'.repeat(priceLevel) : '';

        // Endereço: cadeia completa quando existe; senão a localização
        // cidade/bairro/país (fallback do card legado preservado)
        const fullAddress = this.extractEntityAddress(entity) || locationStr;
        const mapsUrl = this.buildGoogleMapsUrl(fullAddress);
        const entityPhone = this.extractEntityPhone(entity);
        const entityWebsiteRaw = this.extractEntityWebsite(entity);
        const entityWebsiteHref = this.normalizeWebsiteUrl(entityWebsiteRaw);
        const entityWebsiteLabel = entityWebsiteRaw ? entityWebsiteRaw.replace(/^https?:\/\//i, '').replace(/^www\./i, '') : '';

        // Badge de source da ENTITY (curadoria usa SourceUtils e troca
        // este badge pelo dela)
        const sourceLabel = entity.data?.source || entity.source || (entity.data?.google_place_id ? 'google_places' : 'manual');
        const sourceText = this.escapeHtml(String(sourceLabel).replace(/_/g, ' '));

        // Nome: verbete do card. Em clickTarget 'name' vira botão real
        // (única área clicável do card de curadoria).
        const nameHtml = clickTarget === 'name'
            ? `<button type="button" class="collection-card__name-link line-clamp-2" title="View curation details">${this.escapeHtml(name)}</button>`
            : this.escapeHtml(name);

        card.innerHTML = `
            <div class="collection-card__main">
                <!-- Thumbnail explícita (foto como objeto, não fundo):
                     img sem src até o ogImageModule resolver; fallback
                     de gradiente pedra + ícone do tipo por baixo
                     (card nunca fica com mídia vazia) -->
                <div class="collection-card__media">
                    <img class="collection-card__thumb" loading="lazy" decoding="async" alt="" />
                    <div class="collection-card__thumb-fallback" aria-hidden="true">
                        <span class="material-icons">${typeIcon}</span>
                    </div>
                </div>

                <div class="collection-card__body">
                    <div class="collection-card__title-row">
                        <h3 class="card-restaurant-name">
                            ${nameHtml}
                        </h3>
                        <div class="collection-card__badges">
                            <div class="card-type-badge">
                                <span class="material-icons">${typeIcon}</span>
                            </div>
                            ${isNew ? '<div class="card-new-badge">new</div>' : ''}
                        </div>
                    </div>

                    ${(subtitleHtml || cuisineType) ? `
                        <div class="collection-card__subtitle">${this.escapeHtml(subtitleHtml || cuisineType)}</div>
                    ` : ''}

                    ${detailsHtml || ''}

                    <div class="collection-card__meta">
                        <span class="collection-source-badge">
                            <span class="material-icons" aria-hidden="true">inventory_2</span>
                            <span class="collection-source-badge__label">${sourceText}</span>
                        </span>
                        ${fullAddress ? `
                            <div class="collection-card__address" title="${this.escapeHtml(fullAddress)}">
                                <span class="material-icons" aria-hidden="true">place</span>
                                ${mapsUrl
                                    ? `<a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="linked-contact-link line-clamp-2">${this.escapeHtml(fullAddress)}</a>`
                                    : `<span class="line-clamp-2">${this.escapeHtml(fullAddress)}</span>`}
                            </div>
                        ` : ''}
                        ${entityPhone ? `
                            <div class="collection-card__address" title="${this.escapeHtml(entityPhone)}">
                                <span class="material-icons" aria-hidden="true">phone</span>
                                <a href="tel:${this.escapeHtml(entityPhone)}" class="linked-contact-link">${this.escapeHtml(entityPhone)}</a>
                            </div>
                        ` : ''}
                        ${entityWebsiteHref ? `
                            <a href="${entityWebsiteHref}" target="_blank" rel="noopener noreferrer"
                                class="collection-card__website linked-contact-link"
                                title="${this.escapeHtml(entityWebsiteRaw)}">
                                <span class="material-icons" aria-hidden="true">language</span>
                                <span class="line-clamp-1">${this.escapeHtml(entityWebsiteLabel)}</span>
                            </a>
                        ` : ''}
                        ${rating > 0 ? `
                            <div class="collection-card__rating">
                                <span class="material-icons" aria-hidden="true">star</span>
                                <span class="collection-card__rating-value">${rating.toFixed(1)}</span>
                                ${priceIndicator ? `<span class="collection-card__rating-price">• ${this.escapeHtml(priceIndicator)}</span>` : ''}
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;

        // Click handler: card inteiro (entidades) ou só o nome (curadoria)
        if (onClick) {
            if (clickTarget === 'name') {
                const nameBtn = card.querySelector('.collection-card__name-link');
                if (nameBtn) {
                    nameBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onClick(entity);
                    });
                }
            } else {
                card.classList.add('collection-card--clickable');
                card.addEventListener('click', () => onClick(entity));
            }
        }

        if (showEntityActions) {
            const status = entity.status || 'active';
            // tons do padrão único de chips (design-system tokens)
            const statusColors = {
                active: 'chip chip--success',
                pending: 'chip chip--warning',
                archived: 'chip chip--neutral',
                deleted: 'chip chip--danger'
            };

            const syncStatus = entity.sync?.status || 'local';
            const syncIcon = syncStatus === 'synced'
                ? 'cloud_done'
                : (syncStatus === 'pending' ? 'cloud_upload' : (syncStatus === 'conflict' ? 'warning' : 'cloud_off'));
            const syncColor = syncStatus === 'synced'
                ? 'text-green-500'
                : (syncStatus === 'pending' ? 'text-amber-500' : (syncStatus === 'conflict' ? 'text-orange-600' : 'text-gray-400'));

            // Sync silencioso quando normal: o chip só existe para
            // estados que exigem atenção (pending/conflict/error) —
            // "synced" é o normal e não merece peso visual
            const showSyncChip = ['pending', 'conflict', 'error'].includes(syncStatus);

            const actionsRow = document.createElement('div');
            actionsRow.className = 'collection-card__footer';
            actionsRow.innerHTML = `
                <div class="collection-card__status">
                    <span class="${statusColors[status] || statusColors.active} uppercase tracking-wider">
                        ${this.escapeHtml(status)}
                    </span>
                    ${showSyncChip ? `
                    <div class="inline-flex items-center gap-1 text-xs font-medium ${syncColor} bg-white border border-gray-100 rounded-full px-2 py-1" title="Sync Status: ${syncStatus}">
                        <span class="material-icons text-sm">${syncIcon}</span>
                        <span class="capitalize">${syncStatus}</span>
                    </div>
                    ` : ''}
                </div>
                <div class="collection-card__actions">
                    <button class="btn-entity-details card-link-btn" title="Entity Details" aria-label="Entity details">
                        <span class="material-icons" aria-hidden="true">visibility</span>
                        <span>Details</span>
                    </button>
                    <button class="btn-entity-edit card-edit-btn" title="Edit Entity" aria-label="Edit entity">
                        <span class="material-icons" aria-hidden="true">edit</span>
                        <span>Edit</span>
                    </button>
                    <button class="btn-more-curation" title="More actions" aria-label="More actions" aria-haspopup="menu">
                        <span class="material-icons" aria-hidden="true">more_horiz</span>
                    </button>
                </div>
            `;

            const detailsBtn = actionsRow.querySelector('.btn-entity-details');
            const editBtn = actionsRow.querySelector('.btn-entity-edit');
            const moreBtn = actionsRow.querySelector('.btn-more-curation');

            if (detailsBtn && onDetails) {
                detailsBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDetails(entity);
                };
            }

            if (editBtn && onEdit) {
                editBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onEdit(entity);
                };
            }

            // Sync Entity mora no menu ⋯ (rotina neutra — não compete
            // com as ações editoriais por espaço no rodapé)
            if (moreBtn) {
                moreBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._openCardMenu(moreBtn, {
                        sourceInfo: { icon: 'inventory_2', label: String(sourceLabel).replace(/_/g, ' ') },
                        syncLabel: syncStatus,
                        items: onSync ? [{ icon: 'sync', label: 'Sync Entity', onClick: () => onSync(entity) }] : []
                    });
                };
            }

            const linkedContactLinks = card.querySelectorAll('.linked-contact-link');
            linkedContactLinks.forEach(link => {
                link.addEventListener('click', (e) => e.stopPropagation());
            });

            card.appendChild(actionsRow);
        }

        return card;
    }

    /**
     * Get icon for entity type
     * @param {string} type - Entity type
     * @returns {string} Material icon name
     */
    getTypeIcon(type) {
        const icons = {
            restaurant: 'restaurant',
            bar: 'local_bar',
            hotel: 'hotel',
            cafe: 'local_cafe',
            bakery: 'bakery_dining',
            store: 'store',
            attraction: 'attractions',
            museum: 'museum',
            park: 'park'
        };
        return icons[type] || 'place';
    }

    /**
     * Extract city name from entity data
     * Handles multiple data structures and coordinate objects
     * @param {Object} entity - Entity data
     * @returns {string} City name
     */
    extractCity(entity) {
        // Priority 1: Direct city field (Michelin import)
        if (entity.data?.location?.city && typeof entity.data.location.city === 'string' && entity.data.location.city.trim() !== '') {
            return entity.data.location.city;
        }

        // Priority 2: Direct city field in address
        if (entity.data?.address?.city && typeof entity.data.address.city === 'string' && entity.data.address.city.trim() !== '') {
            return entity.data.address.city;
        }

        // Priority 3: addressComponents (Google Places)
        const addressComponents = entity.data?.addressComponents || [];
        if (Array.isArray(addressComponents)) {
            // Look for locality (city) in address components
            const cityComponent = addressComponents.find(comp =>
                comp.types && (
                    comp.types.includes('locality') ||
                    comp.types.includes('administrative_area_level_2')
                )
            );
            if (cityComponent?.longText || cityComponent?.shortText) {
                return cityComponent.longText || cityComponent.shortText;
            }
        }

        // Priority 4: Parse from street (Michelin format often puts it there) or formattedAddress
        const address = entity.data?.formattedAddress ||
            entity.data?.address?.formattedAddress ||
            entity.data?.shortFormattedAddress ||
            entity.data?.address?.street; // Fallback to street string

        if (address && typeof address === 'string' && address.trim() !== '') {
            const parts = address.split(',').map(p => p.trim());
            if (parts.length >= 2) {
                // Get second-to-last part (usually city before state/country)
                let city = parts[parts.length - 2];
                // If it's a number/postal or looks like a country/state abbreviation, try other parts
                // Common case: "555 Johnson St, Victoria, BC V8W 0B2, Canada" -> parts are ["555 Johnson St", "Victoria", "BC V8W 0B2", "Canada"]
                // Here parts.length = 4. 4-2 = 2 -> parts[2] = "BC V8W 0B2" (State/Postal). 4-3 = 1 -> parts[1] = "Victoria"

                if (parts.length >= 3) {
                    // Check if second-to-last looks like state/postal
                    const secondToLast = parts[parts.length - 2];
                    if (/^[A-Z]{2}\s\w+/.test(secondToLast) || /^\d+/.test(secondToLast)) {
                        city = parts[parts.length - 3];
                    }
                }

                // Clean up
                city = city.replace(/\d{5}(-\d{4})?/g, '').trim();
                city = city.replace(/\b\d+\b/g, '').trim();
                city = city.replace(/\s+/g, ' ').trim();

                if (city && city.length > 1 && !city.includes('{') && !city.includes('[')) {
                    return city;
                }
            }
        }

        return 'Unknown';
    }

    /**
     * Create curation card (entity with curation status)
     * @param {Object} entity - Entity data
     * @param {Object} curation - Curation data
     * @param {Object} options - Card options
     * @returns {HTMLElement} Card element
     */
    createCurationCard(entity, curation, options = {}) {
        // clickTarget 'name': o card NÃO é clicável por inteiro — o nome
        // é o único alvo (ver detalhes da curadoria). Edit/View/Links têm
        // cada um o seu affordance, sem áreas sobrepostas.
        const card = this.createEntityCard(entity, {
            ...options,
            clickTarget: 'name',
            showEntityActions: false
        });

        if (curation) {
            // Determine status with proper fallback
            let status = curation.status;
            if (!status) {
                status = curation.entity_id ? 'linked' : 'draft';
            }

            // O accent do card reflete o status da CURATION (não o da entity)
            this._applyStatusAccent(card, status);

            const statusColors = {
                draft: 'chip chip--warning',
                linked: 'chip chip--info',
                active: 'chip chip--success',
                archived: 'chip chip--neutral',
                deleted: 'chip chip--danger',
                done: 'chip chip--success',
                pending: 'chip chip--info'
            };

            const curatorName = curation.curator?.name || 'Unknown';
            const badgeClass = statusColors[status] || statusColors.draft;
            const isLinkedCuration = status === 'linked' || !!curation.entity_id;
            const safeCuratorName = this.escapeHtml(curatorName);

            // 1. Subtitle → chip do curador (mesma posição, novo visual)
            const curatorChipHtml = `
                <span class="material-icons" aria-hidden="true">person</span>
                <span class="collection-card__subtitle-label">${safeCuratorName}</span>
            `;
            const subtitleEl = card.querySelector('.collection-card__subtitle');
            if (subtitleEl) {
                subtitleEl.innerHTML = curatorChipHtml;
            } else {
                const titleRow = card.querySelector('.collection-card__title-row');
                if (titleRow) {
                    const curatorChip = document.createElement('div');
                    curatorChip.className = 'collection-card__subtitle';
                    curatorChip.innerHTML = curatorChipHtml;
                    titleRow.after(curatorChip);
                }
            }

            // 2. Curadoria não mostra rating/preço (comportamento legado
            //    preservado — o véu do rating era removido antes também)
            card.querySelector('.collection-card__rating')?.remove();

            // 3. Badge de source da CURATION (SourceUtils centraliza
            //    origem: Manual Entry / Excel Import / Web Import /
            //    AI generated / API import)
            const sourceInfo = window.SourceUtils.detectSource(curation, entity);
            const sourceBadge = card.querySelector('.collection-source-badge');
            if (sourceBadge) {
                sourceBadge.innerHTML = `
                    <span class="material-icons" aria-hidden="true">${this.escapeHtml(sourceInfo?.icon || 'inventory_2')}</span>
                    <span class="collection-source-badge__label">${this.escapeHtml(sourceInfo?.label || 'unknown')}</span>
                `;
            }

            // 4. Footer: status/sync à esquerda, ações hierarquizadas à
            //    direita — Edit (oliva-soft, primária), View/Link Entity
            //    (neutra, secundária), ⋯ (overflow: source/sync + Delete)
            let syncStatus = curation.sync?.status || 'local';
            let syncIcon = 'cloud_off';
            let syncColor = 'text-gray-400';

            if (syncStatus === 'synced') {
                syncIcon = 'cloud_done';
                syncColor = 'text-green-500';
            } else if (syncStatus === 'pending') {
                syncIcon = 'cloud_upload';
                syncColor = 'text-amber-500';
            } else if (syncStatus === 'error') {
                syncIcon = 'error_outline';
                syncColor = 'text-red-500';
            } else if (syncStatus === 'conflict') {
                syncIcon = 'warning';
                syncColor = 'text-orange-600 bg-orange-50 px-2 py-0.5 rounded cursor-pointer hover:bg-orange-100 border border-orange-200';
            }

            const syncLabel = syncStatus === 'pending' ? 'Syncing...' : syncStatus;

            // Sync silencioso quando normal — o chip só existe para
            // estados que exigem atenção (pending/conflito/erro).
            const showSyncChip = ['pending', 'conflict', 'error'].includes(syncStatus);

            const actionsRow = document.createElement('div');
            actionsRow.className = 'collection-card__footer';
            actionsRow.innerHTML = `
                <div class="collection-card__status">
                    ${status !== 'linked' ? `
                    <span class="${badgeClass} uppercase tracking-wider">
                        ${this.escapeHtml(status)}
                    </span>
                    ` : ''}
                    ${showSyncChip ? `
                    <div class="inline-flex items-center gap-1 text-xs font-medium ${syncColor} ${syncStatus === 'conflict' ? 'sync-conflict-chip' : ''} bg-white border border-gray-100 rounded-full px-2 py-1"
                         title="${syncStatus === 'conflict' ? 'Click to resolve conflict' : `Sync Status: ${this.escapeHtml(syncLabel)}` }">
                        <span class="material-icons text-sm">${syncIcon}</span>
                        <span class="capitalize">${this.escapeHtml(syncLabel)}</span>
                    </div>
                    ` : ''}
                </div>
                <div class="collection-card__actions">
                    ${isLinkedCuration ? `
                    <!-- vínculo ativo: o botão ABRE a página de detalhes da
                         entity linkada (a tag "Linked" foi removida — este
                         botão é quem comunica o vínculo agora) -->
                    <button class="btn-view-entity card-link-btn" title="View linked entity details" aria-label="View linked entity details">
                        <span class="material-icons" aria-hidden="true">visibility</span>
                        <span>View Entity</span>
                    </button>
                    ` : `
                    <!-- sem vínculo: aqui mora o Link Entity (mesmo espaço,
                         mesma linguagem quieta — nada de azul sólido) -->
                    <button class="btn-link-entity card-link-btn" title="Link this curation to an entity" aria-label="Link this curation to an entity">
                        <span class="material-icons" aria-hidden="true">link</span>
                        <span>Link Entity</span>
                    </button>
                    `}
                    <button class="btn-edit-curation card-edit-btn" title="Edit Curation" aria-label="Edit curation">
                        <span class="material-icons" aria-hidden="true">edit</span>
                        <span>Edit</span>
                    </button>
                    <button class="btn-more-curation" title="More actions" aria-label="More actions" aria-haspopup="menu">
                        <span class="material-icons" aria-hidden="true">more_horiz</span>
                    </button>
                </div>
            `;

            // Chip de conflito: listener real (nunca inline onclick — o
            // curation_id vem do servidor e não pode ser interpolado em
            // string JS dentro de atributo HTML)
            const conflictChip = actionsRow.querySelector('.sync-conflict-chip');
            if (conflictChip) {
                conflictChip.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (window.uiManager && typeof window.uiManager.resolveConflict === 'function') {
                        window.uiManager.resolveConflict(curation.entity_id ? 'curation' : 'entity', curation.curation_id);
                    }
                });
            }

            // Add event listeners to buttons
            const editBtn = actionsRow.querySelector('.btn-edit-curation');
            const viewEntityBtn = actionsRow.querySelector('.btn-view-entity');
            const linkEntityBtn = actionsRow.querySelector('.btn-link-entity');
            const moreBtn = actionsRow.querySelector('.btn-more-curation');

            if (editBtn) {
                editBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Entrada externa de edição é route-first (M4 da spec
                    // F1): o handler da rota faz checkout + abre o editor;
                    // sem navigationManager cai no caminho direto antigo
                    const nm = window.navigationManager;
                    if (nm && typeof nm.goTo === 'function' && curation?.curation_id) {
                        nm.goTo(`/curation/${curation.curation_id}/edit`, { state: { curation } });
                    } else if (window.uiManager && typeof window.uiManager.editCuration === 'function') {
                        window.uiManager.editCuration(curation);
                    }
                };
            }

            const linkedContactLinks = card.querySelectorAll('.linked-contact-link');
            linkedContactLinks.forEach(link => {
                link.addEventListener('click', (e) => e.stopPropagation());
            });

            // Vínculo ativo: abre os detalhes da entity linkada (o botão
            // substitui a antiga tag "Linked" + o unlink icônico)
            if (viewEntityBtn) {
                viewEntityBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (window.entityModule && typeof window.entityModule.showEntityDetails === 'function') {
                        window.entityModule.showEntityDetails(entity);
                    }
                };
            }

            // Sem vínculo: abre o seletor de entity (mesmo fluxo do Link
            // Review do uiManager) — o modal retorna a entity e vincula
            if (linkEntityBtn) {
                linkEntityBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (window.uiManager && typeof window.uiManager.handleLinkReviewToEntity === 'function') {
                        window.uiManager.handleLinkReviewToEntity(curation);
                    }
                };
            }

            // Menu "⋯": source/sync como detalhe + Delete (nível
            // operacional secundário — o card fica editorial)
            if (moreBtn) {
                moreBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._openCardMenu(moreBtn, {
                        sourceInfo,
                        syncLabel,
                        onDelete: () => {
                            if (window.uiManager && typeof window.uiManager.confirmDeleteCuration === 'function') {
                                window.uiManager.confirmDeleteCuration(curation.curation_id);
                            }
                        }
                    });
                };
            }

            card.appendChild(actionsRow);
        }

        return card;
    }

    /**
     * Fecha o menu "⋯" aberto (singleton global — um menu por vez).
     */
    _closeCardMenu() {
        if (window.__cardMoreMenu) {
            window.__cardMoreMenu.remove();
            window.__cardMoreMenu = null;
        }
    }

    /**
     * Abre o menu "⋯" do card: source/sync como detalhe informativo e
     * ações destrutivas (Delete Curation). Posicionado fixo sob o botão;
     * fecha em clique fora (o listener de fora é anexado após o evento
     * atual terminar de propagar, senão ele mesmo fecharia o menu).
     * Conteúdo montado com textContent — nada de innerHTML com dados.
     */
    _openCardMenu(anchor, { sourceInfo, syncLabel, items = [], onDelete }) {
        this._closeCardMenu();

        const menu = document.createElement('div');
        menu.className = 'card-more-menu';
        menu.setAttribute('role', 'menu');

        const sourceLine = document.createElement('div');
        sourceLine.className = 'card-more-menu__item card-more-menu__info';
        const sourceIcon = document.createElement('span');
        sourceIcon.className = 'material-icons';
        sourceIcon.setAttribute('aria-hidden', 'true');
        sourceIcon.textContent = sourceInfo?.icon || 'inventory_2';
        const sourceText = document.createElement('span');
        sourceText.textContent = `Source: ${sourceInfo?.label || 'unknown'}`;
        sourceLine.append(sourceIcon, sourceText);
        menu.appendChild(sourceLine);

        const syncLine = document.createElement('div');
        syncLine.className = 'card-more-menu__item card-more-menu__info';
        const syncIcon = document.createElement('span');
        syncIcon.className = 'material-icons';
        syncIcon.setAttribute('aria-hidden', 'true');
        syncIcon.textContent = 'cloud';
        const syncText = document.createElement('span');
        syncText.textContent = `Sync: ${syncLabel || 'unknown'}`;
        syncLine.append(syncIcon, syncText);
        menu.appendChild(syncLine);

        // Itens operacionais extras (ex.: Unlink no review card) — mesmo
        // visual dos demais itens; conteúdo via textContent.
        items.forEach((item) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'card-more-menu__item';
            btn.setAttribute('role', 'menuitem');
            const icon = document.createElement('span');
            icon.className = 'material-icons';
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = item.icon || 'more_horiz';
            const label = document.createElement('span');
            label.textContent = item.label || '';
            btn.append(icon, label);
            btn.addEventListener('click', () => {
                this._closeCardMenu();
                if (typeof item.onClick === 'function') item.onClick();
            });
            menu.appendChild(btn);
        });

        if (typeof onDelete === 'function') {
            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'card-more-menu__item card-more-menu__danger';
            deleteBtn.setAttribute('role', 'menuitem');
            const delIcon = document.createElement('span');
            delIcon.className = 'material-icons';
            delIcon.setAttribute('aria-hidden', 'true');
            delIcon.textContent = 'delete_outline';
            const delText = document.createElement('span');
            delText.textContent = 'Delete Curation';
            deleteBtn.append(delIcon, delText);
            deleteBtn.addEventListener('click', () => {
                this._closeCardMenu();
                onDelete();
            });
            menu.appendChild(deleteBtn);
        }

        document.body.appendChild(menu);
        const rect = anchor.getBoundingClientRect();
        menu.style.top = `${rect.bottom + 6}px`;
        menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;

        window.__cardMoreMenu = menu;
        const onOutsideClick = (ev) => {
            if (menu.contains(ev.target)) return;
            this._closeCardMenu();
            document.removeEventListener('click', onOutsideClick);
        };
        setTimeout(() => document.addEventListener('click', onOutsideClick), 0);
    }

    extractEntityAddress(entity) {
        return entity?.data?.formattedAddress ||
            entity?.data?.address?.formattedAddress ||
            entity?.data?.address?.street ||
            entity?.data?.location?.address ||
            entity?.address ||
            '';
    }

    extractEntityPhone(entity) {
        return entity?.data?.contact?.phone ||
            entity?.data?.contacts?.phone ||
            entity?.data?.formattedPhone ||
            entity?.data?.internationalPhone ||
            entity?.data?.phone ||
            entity?.phone ||
            '';
    }

    extractEntityWebsite(entity) {
        return entity?.data?.contact?.website ||
            entity?.data?.contacts?.website ||
            entity?.data?.website ||
            entity?.website ||
            '';
    }

    normalizeWebsiteUrl(url) {
        if (!url || typeof url !== 'string') {
            return '';
        }

        const trimmed = url.trim();
        if (!trimmed) {
            return '';
        }

        return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    }

    buildGoogleMapsUrl(address) {
        if (!address || typeof address !== 'string' || !address.trim()) {
            return '';
        }

        return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;
    }

    escapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = value || '';
        // O serializer de innerHTML NÃO escapa aspas em texto — sem o replace,
        // um valor com `"` quebra atributos (title=, data-*, href=) quando o
        // resultado é interpolado neles. Escapar aspas torna o helper seguro
        // para texto E atributo (&quot;/&#39; renderizam idênticos no texto).
        return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /**
     * Create empty state card
     * @param {Object} options - Empty state options
     * @returns {HTMLElement} Empty state element
     */
    createEmptyState(options = {}) {
        const {
            icon = 'inbox',
            title = 'No items',
            message = 'Nothing to show here',
            action = null
        } = options;

        const container = document.createElement('div');
        container.className = 'empty-state';

        container.innerHTML = `
            <span class="empty-state-icon material-icons">${this.escapeHtml(icon)}</span>
            <p class="empty-state-title">${this.escapeHtml(title)}</p>
            <p class="empty-state-description">${this.escapeHtml(message)}</p>
            ${action ? `
                <button class="empty-state-action btn btn-primary btn-sm">
                    ${this.escapeHtml(action.label)}
                </button>
            ` : ''}
        `;

        if (action?.onClick) {
            const button = container.querySelector('button');
            if (button) {
                button.addEventListener('click', action.onClick);
            }
        }

        return container;
    }

    /**
     * Create loading skeleton card
     * @returns {HTMLElement} Skeleton card element
     */
    createSkeletonCard() {
        // Esqueleto na MESMA shell do card real (thumb + linhas de
        // texto + rodapé) — sem layout shift quando os dados chegam.
        const card = document.createElement('div');
        card.className = 'collection-card skeleton-card animate-pulse';
        card.setAttribute('aria-hidden', 'true');

        card.innerHTML = `
            <div class="collection-card__main">
                <div class="collection-card__media skeleton-block"></div>
                <div class="collection-card__body">
                    <div class="skeleton-block skeleton-line" style="width: 70%"></div>
                    <div class="skeleton-block skeleton-line" style="width: 45%"></div>
                    <div class="skeleton-block skeleton-line" style="width: 85%"></div>
                    <div class="skeleton-block skeleton-line" style="width: 55%"></div>
                </div>
            </div>
            <div class="collection-card__footer">
                <div class="skeleton-block skeleton-line" style="width: 30%"></div>
                <div class="skeleton-block skeleton-line" style="width: 40%; margin-left: auto"></div>
            </div>
        `;

        return card;
    }
});

// Initialize and expose globally
if (typeof window !== 'undefined') {
    window.CardFactory = new CardFactory();
}
