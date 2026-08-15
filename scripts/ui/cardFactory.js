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
            variant = 'default', // default, compact, detailed
            showActions = true,
            onClick = null,
            subtitleHtml = null,
            detailsHtml = '',
            showEntityActions = false,
            onEdit = null,
            onDetails = null,
            onSync = null
        } = options;

        const card = document.createElement('div');
        // Added h-full, flex, flex-col for equal height cards
        card.className = 'bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-lg hover:border-blue-300 transition-all duration-200 cursor-pointer group h-full flex flex-col justify-between relative';
        card.dataset.entityId = entity.entity_id;
        this._applyStatusAccent(card, entity.status || 'active');

        const name = entity.name || 'Unknown';
        const type = entity.type || 'restaurant';

        // Extract city using robust method
        const city = this.extractCity(entity);
        const neighborhood = entity.data?.address?.neighborhood || entity.data?.location?.neighborhood || '';
        const country = entity.data?.address?.country || entity.data?.location?.country || '';
        const rating = entity.data?.attributes?.rating || entity.data?.rating || 0;
        const priceLevel = entity.data?.attributes?.price_level || entity.data?.price_level || 0;
        const cuisine = entity.data?.attributes?.cuisine || entity.data?.cuisine || [];
        const phone = entity.data?.contact?.phone || entity.data?.contacts?.phone || entity.data?.phone || '';
        // Tolerante aos dois shapes (v3 singular + bulk plural) — mesma
        // cadeia do extractEntityWebsite: sem isso, entities com
        // data.contacts.website ficavam sem data-og-source (sem véu)
        const website =
            entity.data?.contact?.website ||
            entity.data?.contacts?.website ||
            entity.data?.website ||
            entity?.website || '';

        // Véu de imagem OG (ogImageModule resolve em real-time via
        // /api/v3/og-image). Fonte primária: website. Fallback de
        // cobertura: place_id → foto do Google Places (muitos sites de
        // restaurante não têm og:image — o place_id cobre a lacuna).
        if (website) {
            card.dataset.ogSource = website;
        }
        const placeId = entity.data?.place_id || entity.place_id || '';
        if (placeId) {
            card.dataset.ogPlaceId = placeId;
        }

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

        card.innerHTML = `
            <!-- Véu de imagem OG (degrade suave direita→card) —
                 preenchido pelo ogImageModule; sem site nem place_id,
                 o módulo aplica o véu de FALLBACK (gradiente no tom do
                 status + ícone fantasma do tipo — princípio feedmine de
                 card nunca ficar branco vazio, contentTypePlaceholder) -->
            <div class="card-og-veil" aria-hidden="true">
                <span class="card-og-veil__icon material-icons">${this.getTypeIcon(type)}</span>
            </div>
            <!-- Header with type icon (badge circular perfeito via
                 .card-type-badge — o div com p-2 + inline-block criava
                 círculo oval e glifo descentralizado) -->
            <div class="absolute top-3 right-3 z-10">
                <div class="card-type-badge">
                    <span class="material-icons text-gray-600">${this.getTypeIcon(type)}</span>
                </div>
            </div>
            
            <!-- Main content - flex-grow to push footer down -->
            <div class="entity-card-main p-5 flex-grow">
                <!-- Name and cuisine -->
                <div class="entity-card-header mb-3">
                    <!-- card-restaurant-name: serif de exibição (Cormorant
                         Garamond) — o nome é o verbete do card, como em
                         um caderno de curadoria. Hover via .group em CSS. -->
                    <h3 class="entity-card-name card-restaurant-name mb-2 pr-12 line-clamp-2">
                        ${this.escapeHtml(name)}
                    </h3>
                    ${(subtitleHtml || cuisineType) ? `
                        <div class="entity-card-subtitle text-sm text-gray-500 font-medium">${this.escapeHtml(subtitleHtml || cuisineType)}</div>
                    ` : ''}
                </div>

                ${detailsHtml || ''}
                
                <!-- Location -->
                <div class="entity-card-location flex items-start gap-2 mb-3 text-sm text-gray-600">
                    <span class="material-icons text-base mt-0.5 flex-shrink-0">place</span>
                    <span class="line-clamp-2">${this.escapeHtml(locationStr)}</span>
                </div>
                
                <!-- Rating and Price -->
                <div class="entity-card-rating flex items-center gap-4 mb-4">
                    ${rating > 0 ? `
                        <div class="flex items-center gap-1.5">
                            <span class="material-icons text-base text-yellow-500">star</span>
                            <span class="font-semibold text-gray-900">${rating.toFixed(1)}</span>
                        </div>
                    ` : ''}
                    ${priceIndicator ? `
                        <div class="flex items-center">
                            <span class="font-semibold text-gray-700">${priceIndicator}</span>
                        </div>
                    ` : ''}
                </div>
                
                <!-- Contact info -->
                ${phone || website ? `
                    <div class="entity-card-contact flex items-center gap-3 pt-3 border-t border-gray-100">
                        ${phone ? `
                            <div class="flex items-center gap-1.5 text-xs text-gray-500" title="${this.escapeHtml(phone)}">
                                <span class="material-icons text-sm">phone</span>
                                <span class="truncate" style="max-width:150px">${this.escapeHtml(phone)}</span>
                            </div>
                        ` : ''}
                        ${website ? `
                            <div class="flex items-center gap-1.5 text-xs text-blue-600" title="Has website">
                                <span class="material-icons text-sm">language</span>
                            </div>
                        ` : ''}
                    </div>
                ` : ''}
            </div>
            
            <!-- Hover overlay effect: véu de oliva sutil (card-veil em
                 components.css — substitui o gradiente blue-50 antigo) -->
            <div class="card-veil"></div>
        `;

        // Click handler
        if (onClick) {
            card.addEventListener('click', () => onClick(entity));
        } else {
            card.addEventListener('click', () => {
                console.log('Entity clicked:', entity.entity_id);
            });
        }

        if (showEntityActions) {
            const fullAddress = this.extractEntityAddress(entity);
            const mapsUrl = this.buildGoogleMapsUrl(fullAddress);
            const entityPhone = this.extractEntityPhone(entity);
            const entityWebsiteRaw = this.extractEntityWebsite(entity);
            const entityWebsiteHref = this.normalizeWebsiteUrl(entityWebsiteRaw);
            const entityWebsiteLabel = entityWebsiteRaw ? entityWebsiteRaw.replace(/^https?:\/\//i, '').replace(/^www\./i, '') : '';

            card.querySelector('.entity-card-location')?.remove();
            card.querySelector('.entity-card-rating')?.remove();
            card.querySelector('.entity-card-contact')?.remove();

            const entityMainEl = card.querySelector('.entity-card-main');
            if (entityMainEl && (fullAddress || entityPhone || entityWebsiteHref || rating > 0 || priceIndicator)) {
                const detailsEl = document.createElement('div');
                detailsEl.className = 'entity-curation-details pt-1 space-y-2';
                detailsEl.innerHTML = `
                    ${fullAddress ? `
                        <div class="flex items-start gap-1.5 text-xs text-gray-600" title="${this.escapeHtml(fullAddress)}">
                            <span class="material-icons text-sm mt-px flex-shrink-0">place</span>
                            ${mapsUrl ? `<a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="linked-contact-link hover:underline line-clamp-2">${this.escapeHtml(fullAddress)}</a>` : `<span class="line-clamp-2">${this.escapeHtml(fullAddress)}</span>`}
                        </div>
                    ` : ''}
                    ${entityPhone ? `
                        <div class="flex items-center gap-1.5 text-xs text-gray-600" title="${this.escapeHtml(entityPhone)}">
                            <span class="material-icons text-sm">phone</span>
                            <a href="tel:${this.escapeHtml(entityPhone)}" class="linked-contact-link hover:underline">${this.escapeHtml(entityPhone)}</a>
                        </div>
                    ` : ''}
                    ${entityWebsiteHref ? `
                        <div class="flex items-center gap-1.5 text-xs text-blue-700" title="${this.escapeHtml(entityWebsiteRaw)}">
                            <span class="material-icons text-sm">language</span>
                            <a href="${entityWebsiteHref}" target="_blank" rel="noopener noreferrer" class="linked-contact-link hover:underline line-clamp-1">${this.escapeHtml(entityWebsiteLabel)}</a>
                        </div>
                    ` : ''}
                    ${rating > 0 ? `
                        <div class="flex items-center gap-1.5 text-xs text-amber-700">
                            <span class="material-icons text-sm">star</span>
                            <span class="font-semibold">${rating.toFixed(1)}</span>
                            ${priceIndicator ? `<span class="text-gray-600">• ${this.escapeHtml(priceIndicator)}</span>` : ''}
                        </div>
                    ` : ''}
                `;
                entityMainEl.appendChild(detailsEl);
            }

            const actionsRow = document.createElement('div');
            actionsRow.className = 'mt-auto p-4 mx-1 border-t border-gray-100 bg-white z-20 relative space-y-3';

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

            const sourceLabel = entity.data?.source || entity.source || (entity.data?.google_place_id ? 'google_places' : 'manual');
            const sourceText = this.escapeHtml(String(sourceLabel).replace(/_/g, ' '));

            actionsRow.innerHTML = `
                <div class="space-y-2">
                    <div class="flex flex-wrap items-center gap-1.5">
                        <span class="${statusColors[status] || statusColors.active} uppercase tracking-wider">
                            ${this.escapeHtml(status)}
                        </span>
                        <div class="inline-flex items-center gap-1 text-xs font-medium text-gray-700 bg-gray-50 border border-gray-100 rounded-full px-2 py-1">
                            <span class="material-icons text-sm">inventory_2</span>
                            <span>${sourceText}</span>
                        </div>
                        <div class="inline-flex items-center gap-1 text-xs font-medium ${syncColor} bg-white border border-gray-100 rounded-full px-2 py-1" title="Sync Status: ${syncStatus}">
                            <span class="material-icons text-sm">${syncIcon}</span>
                            <span class="capitalize">${syncStatus}</span>
                        </div>
                    </div>
                </div>
                <div class="grid grid-cols-3 gap-2 pt-1">
                    <button class="btn-entity-details icon-btn w-full text-gray-700 hover:bg-gray-100" title="Entity Details">
                        <span class="material-icons text-lg">info</span>
                    </button>
                    <button class="btn-entity-sync h-10 w-full flex items-center justify-center bg-gray-50 text-amber-700 hover:bg-amber-50 rounded-lg transition-all border border-gray-100 shadow-sm" title="Sync Entity">
                        <span class="material-icons text-lg">sync</span>
                    </button>
                    <button class="btn-entity-edit card-edit-btn" title="Edit Entity">
                        <span class="material-icons text-lg">edit</span>
                    </button>
                </div>
            `;

            const detailsBtn = actionsRow.querySelector('.btn-entity-details');
            const syncBtn = actionsRow.querySelector('.btn-entity-sync');
            const editBtn = actionsRow.querySelector('.btn-entity-edit');

            if (detailsBtn && onDetails) {
                detailsBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDetails(entity);
                };
            }

            if (syncBtn && onSync) {
                syncBtn.onclick = async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    await onSync(entity);
                };
            }

            if (editBtn && onEdit) {
                editBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onEdit(entity);
                };
            }

            const linkedContactLinks = actionsRow.querySelectorAll('.linked-contact-link');
            linkedContactLinks.forEach(link => {
                link.addEventListener('click', (e) => e.stopPropagation());
            });

            const entityMainLinks = card.querySelectorAll('.entity-curation-details .linked-contact-link');
            entityMainLinks.forEach(link => {
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
        const card = this.createEntityCard(entity, options);

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

            // 1. Clean up top-right header (keep only entity type icon)
            // No changes needed to createEntityCard, it already has the icon.
            // We just don't insert buttons there anymore.

            // 2. Create Curation Actions Row
            const actionsRow = document.createElement('div');
            actionsRow.className = 'mt-4 pt-4 border-t border-gray-100 flex items-center justify-between';

            const curatorName = curation.curator?.name || 'Unknown';
            const badgeClass = statusColors[status] || statusColors.draft;
            const isLinkedCuration = status === 'linked' || !!curation.entity_id;

            const fullAddress = this.extractEntityAddress(entity);
            const mapsUrl = this.buildGoogleMapsUrl(fullAddress);
            const phone = this.extractEntityPhone(entity);
            const websiteRaw = this.extractEntityWebsite(entity);
            const websiteHref = this.normalizeWebsiteUrl(websiteRaw);
            const websiteLabel = websiteRaw ? websiteRaw.replace(/^https?:\/\//i, '').replace(/^www\./i, '') : '';
            const safeCuratorName = this.escapeHtml(curatorName);

            const bodyDetails = isLinkedCuration && (fullAddress || phone || websiteHref) ? `                <div class="entity-curation-details pt-1 space-y-2">
                    ${fullAddress ? `
                        <div class="flex items-start gap-1.5 text-xs text-gray-600" title="${this.escapeHtml(fullAddress)}">
                            <span class="material-icons text-sm mt-px flex-shrink-0">place</span>
                            ${mapsUrl
                    ? `<a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="linked-contact-link hover:underline line-clamp-2">${this.escapeHtml(fullAddress)}</a>`
                    : `<span class="line-clamp-2">${this.escapeHtml(fullAddress)}</span>`}
                        </div>
                    ` : ''}
                    ${phone ? `
                        <div class="flex items-center gap-1.5 text-xs text-gray-600" title="${this.escapeHtml(phone)}">
                            <span class="material-icons text-sm">phone</span>
                            <a href="tel:${this.escapeHtml(phone)}" class="linked-contact-link hover:underline">${this.escapeHtml(phone)}</a>
                        </div>
                    ` : ''}
                    ${websiteHref ? `
                        <div class="flex items-center gap-1.5 text-xs text-blue-700" title="${this.escapeHtml(websiteRaw)}">
                            <span class="material-icons text-sm">language</span>
                            <a href="${websiteHref}" target="_blank" rel="noopener noreferrer" class="linked-contact-link hover:underline line-clamp-1">${this.escapeHtml(websiteLabel)}</a>
                        </div>
                    ` : ''}
                </div>
            ` : '';

            const subtitleEl = card.querySelector('.entity-card-subtitle');
            if (subtitleEl) {
                subtitleEl.innerHTML = `
                    <span class="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-full px-2 py-1">
                        <span class="material-icons text-sm">person</span>
                        <span class="font-medium">${safeCuratorName}</span>
                    </span>
                `;
            } else {
                const headerEl = card.querySelector('.entity-card-header');
                if (headerEl) {
                    const curatorChip = document.createElement('div');
                    curatorChip.className = 'entity-card-subtitle text-sm text-gray-500 font-medium';
                    curatorChip.innerHTML = `
                        <span class="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-full px-2 py-1">
                            <span class="material-icons text-sm">person</span>
                            <span class="font-medium">${safeCuratorName}</span>
                        </span>
                    `;
                    headerEl.appendChild(curatorChip);
                }
            }

            card.querySelector('.entity-card-location')?.remove();
            card.querySelector('.entity-card-rating')?.remove();
            card.querySelector('.entity-card-contact')?.remove();

            if (bodyDetails) {
                const mainEl = card.querySelector('.entity-card-main');
                if (mainEl) {
                    const detailsEl = document.createElement('div');
                    detailsEl.innerHTML = bodyDetails;
                    mainEl.appendChild(detailsEl);
                }
            }


            // Use centralized SourceUtils for consistent logic and styling
            const sourceInfo = window.SourceUtils.detectSource(curation, entity);

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

            actionsRow.innerHTML = `
                <div class="space-y-3">
                    <div class="flex flex-wrap items-center gap-1.5">
                        ${status !== 'linked' ? `
                        <span class="${badgeClass} uppercase tracking-wider">
                            ${this.escapeHtml(status)}
                        </span>
                        ` : ''}
                        <div class="${sourceInfo.className}">
                            <span class="material-icons">${this.escapeHtml(sourceInfo.icon)}</span>
                            ${this.escapeHtml(sourceInfo.label)}
                        </div>
                        <div class="inline-flex items-center gap-1 text-xs font-medium ${syncColor} ${syncStatus === 'conflict' ? 'sync-conflict-chip' : ''} bg-white border border-gray-100 rounded-full px-2 py-1"
                             title="${syncStatus === 'conflict' ? 'Click to resolve conflict' : `Sync Status: ${this.escapeHtml(syncLabel)}` }">
                            <span class="material-icons text-sm">${syncIcon}</span>
                            <span class="capitalize">${this.escapeHtml(syncLabel)}</span>
                        </div>
                    </div>
                </div>
                <div class="grid grid-cols-3 gap-2 pt-1">
                    <button class="btn-delete-curation icon-btn w-full text-red-500 hover:bg-red-50 hover:text-red-700 hover:border-red-200" title="Delete Curation">
                        <span class="material-icons text-lg">delete_outline</span>
                    </button>
                    ${isLinkedCuration ? `
                    <!-- vínculo ativo: o botão ABRE a página de detalhes da
                         entity linkada (a tag "Linked" foi removida — este
                         botão é quem comunica o vínculo agora) -->
                    <button class="btn-view-entity card-link-btn" title="View linked entity details">
                        <span class="material-icons text-base">visibility</span>
                        View Entity
                    </button>
                    ` : `
                    <!-- sem vínculo: aqui mora o Link Entity (mesmo espaço,
                         mesma linguagem quieta — nada de azul sólido) -->
                    <button class="btn-link-entity card-link-btn" title="Link this curation to an entity">
                        <span class="material-icons text-base">link</span>
                        Link Entity
                    </button>
                    `}
                    <button class="btn-edit-curation card-edit-btn" title="Edit Curation">
                        <span class="material-icons text-lg">edit</span>
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
            const deleteBtn = actionsRow.querySelector('.btn-delete-curation');
            const viewEntityBtn = actionsRow.querySelector('.btn-view-entity');
            const linkEntityBtn = actionsRow.querySelector('.btn-link-entity');

            if (editBtn) {
                editBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (window.uiManager && typeof window.uiManager.editCuration === 'function') {
                        window.uiManager.editCuration(curation);
                    }
                };
            }

            const linkedContactLinks = actionsRow.querySelectorAll('.linked-contact-link');
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

            if (deleteBtn) {
                deleteBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (window.uiManager && typeof window.uiManager.confirmDeleteCuration === 'function') {
                        window.uiManager.confirmDeleteCuration(curation.curation_id);
                    }
                };
            }

            // NEW: Append actions row to the CARD itself (footer), not the content area
            // This ensures it stays at the bottom due to flex-col and flex-grow on content
            actionsRow.className = 'mt-auto p-4 mx-1 border-t border-gray-100 bg-white z-20 relative space-y-3';
            card.appendChild(actionsRow);
        }

        return card;
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
        container.className = 'col-span-full text-center py-12';

        container.innerHTML = `
            <span class="material-icons text-6xl text-gray-300 mb-4">${this.escapeHtml(icon)}</span>
            <p class="text-gray-500 mb-2 font-medium">${this.escapeHtml(title)}</p>
            <p class="text-sm text-gray-400">${this.escapeHtml(message)}</p>
            ${action ? `
                <button class="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
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
        const card = document.createElement('div');
        card.className = 'bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden animate-pulse';

        card.innerHTML = `
            <div class="p-5">
                <div class="flex justify-between mb-3">
                    <div class="h-6 bg-gray-200 rounded w-3/4"></div>
                    <div class="h-8 w-8 bg-gray-200 rounded-full"></div>
                </div>
                <div class="h-4 bg-gray-200 rounded w-1/2 mb-3"></div>
                <div class="h-4 bg-gray-200 rounded w-2/3 mb-4"></div>
                <div class="flex gap-4 mb-4">
                    <div class="h-4 bg-gray-200 rounded w-16"></div>
                    <div class="h-4 bg-gray-200 rounded w-12"></div>
                </div>
                <div class="flex gap-3 pt-3 border-t border-gray-100">
                    <div class="h-4 bg-gray-200 rounded w-24"></div>
                </div>
            </div>
        `;

        return card;
    }
});

// Initialize and expose globally
if (typeof window !== 'undefined') {
    window.CardFactory = new CardFactory();
}
