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
        const website = entity.data?.contact?.website || entity.data?.website || '';

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
            <!-- Header with type icon -->
            <div class="absolute top-3 right-3 flex items-center gap-2 z-10">
                <div class="bg-white/90 backdrop-blur-sm rounded-full p-2 shadow-sm">
                    <span class="material-icons text-lg text-gray-600">${this.getTypeIcon(type)}</span>
                </div>
            </div>
            
            <!-- Main content - flex-grow to push footer down -->
            <div class="entity-card-main p-5 flex-grow">
                <!-- Name and cuisine -->
                <div class="entity-card-header mb-3">
                    <h3 class="entity-card-name font-bold text-lg text-gray-900 mb-1 pr-12 line-clamp-2 group-hover:text-blue-600 transition-colors">
                        ${name}
                    </h3>
                    ${(subtitleHtml || cuisineType) ? `
                        <div class="entity-card-subtitle text-sm text-gray-500 font-medium">${subtitleHtml || cuisineType}</div>
                    ` : ''}
                </div>

                ${detailsHtml || ''}
                
                <!-- Location -->
                <div class="entity-card-location flex items-start gap-2 mb-3 text-sm text-gray-600">
                    <span class="material-icons text-base mt-0.5 flex-shrink-0">place</span>
                    <span class="line-clamp-2">${locationStr}</span>
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
                            <div class="flex items-center gap-1.5 text-xs text-gray-500" title="${phone}">
                                <span class="material-icons text-sm">phone</span>
                                <span class="truncate max-w-[150px]">${phone}</span>
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
            
            <!-- Hover overlay effect -->
            <div class="absolute inset-0 bg-gradient-to-t from-blue-50/0 to-blue-50/0 group-hover:from-blue-50/30 group-hover:to-transparent transition-all duration-200 pointer-events-none"></div>
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
                            <span class="material-icons text-[14px] mt-[1px] flex-shrink-0">place</span>
                            ${mapsUrl ? `<a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="linked-contact-link hover:underline line-clamp-2">${this.escapeHtml(fullAddress)}</a>` : `<span class="line-clamp-2">${this.escapeHtml(fullAddress)}</span>`}
                        </div>
                    ` : ''}
                    ${entityPhone ? `
                        <div class="flex items-center gap-1.5 text-xs text-gray-600" title="${this.escapeHtml(entityPhone)}">
                            <span class="material-icons text-[14px]">phone</span>
                            <a href="tel:${this.escapeHtml(entityPhone)}" class="linked-contact-link hover:underline">${this.escapeHtml(entityPhone)}</a>
                        </div>
                    ` : ''}
                    ${entityWebsiteHref ? `
                        <div class="flex items-center gap-1.5 text-xs text-blue-700" title="${this.escapeHtml(entityWebsiteRaw)}">
                            <span class="material-icons text-[14px]">language</span>
                            <a href="${entityWebsiteHref}" target="_blank" rel="noopener noreferrer" class="linked-contact-link hover:underline line-clamp-1">${this.escapeHtml(entityWebsiteLabel)}</a>
                        </div>
                    ` : ''}
                    ${rating > 0 ? `
                        <div class="flex items-center gap-1.5 text-xs text-amber-700">
                            <span class="material-icons text-[14px]">star</span>
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
            const statusColors = {
                active: 'bg-green-100 text-green-800',
                pending: 'bg-yellow-100 text-yellow-800',
                archived: 'bg-gray-100 text-gray-800',
                deleted: 'bg-red-100 text-red-800'
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
                    <div class="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap">
                        <span class="${statusColors[status] || statusColors.active} rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider shadow-sm">
                            ${this.escapeHtml(status)}
                        </span>
                        <div class="inline-flex items-center gap-1 text-[11px] font-medium text-gray-700 bg-gray-50 border border-gray-100 rounded-full px-2 py-1">
                            <span class="material-icons text-[14px]">inventory_2</span>
                            <span>${sourceText}</span>
                        </div>
                        <div class="inline-flex items-center gap-1 text-[11px] font-medium ${syncColor} bg-white border border-gray-100 rounded-full px-2 py-1" title="Sync Status: ${syncStatus}">
                            <span class="material-icons text-[14px]">${syncIcon}</span>
                            <span class="capitalize">${syncStatus}</span>
                        </div>
                    </div>
                </div>
                <div class="grid grid-cols-3 gap-2 pt-1">
                    <button class="btn-entity-details h-10 w-full flex items-center justify-center bg-gray-50 text-gray-700 hover:bg-gray-100 rounded-lg transition-all border border-gray-100 shadow-sm" title="Entity Details">
                        <span class="material-icons text-[18px]">info</span>
                    </button>
                    <button class="btn-entity-sync h-10 w-full flex items-center justify-center bg-gray-50 text-amber-700 hover:bg-amber-50 rounded-lg transition-all border border-gray-100 shadow-sm" title="Sync Entity">
                        <span class="material-icons text-[18px]">sync</span>
                    </button>
                    <button class="btn-entity-edit h-10 w-full flex items-center justify-center bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-all border border-blue-600 shadow-sm" title="Edit Entity">
                        <span class="material-icons text-[18px]">edit</span>
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

            const statusColors = {
                draft: 'bg-yellow-100 text-yellow-800',
                linked: 'bg-blue-100 text-blue-800',
                active: 'bg-green-100 text-green-800',
                archived: 'bg-gray-100 text-gray-800',
                deleted: 'bg-red-100 text-red-800',
                done: 'bg-green-100 text-green-800',
                pending: 'bg-blue-100 text-blue-800'
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

            const bodyDetails = isLinkedCuration && (fullAddress || phone || websiteHref) ? `
                <div class="entity-curation-details pt-1 space-y-2">
                    ${fullAddress ? `
                        <div class="flex items-start gap-1.5 text-xs text-gray-600" title="${this.escapeHtml(fullAddress)}">
                            <span class="material-icons text-[14px] mt-[1px] flex-shrink-0">place</span>
                            ${mapsUrl
                    ? `<a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="linked-contact-link hover:underline line-clamp-2">${this.escapeHtml(fullAddress)}</a>`
                    : `<span class="line-clamp-2">${this.escapeHtml(fullAddress)}</span>`}
                        </div>
                    ` : ''}
                    ${phone ? `
                        <div class="flex items-center gap-1.5 text-xs text-gray-600" title="${phone}">
                            <span class="material-icons text-[14px]">phone</span>
                            <a href="tel:${phone}" class="linked-contact-link hover:underline">${phone}</a>
                        </div>
                    ` : ''}
                    ${websiteHref ? `
                        <div class="flex items-center gap-1.5 text-xs text-blue-700" title="${websiteRaw}">
                            <span class="material-icons text-[14px]">language</span>
                            <a href="${websiteHref}" target="_blank" rel="noopener noreferrer" class="linked-contact-link hover:underline line-clamp-1">${websiteLabel}</a>
                        </div>
                    ` : ''}
                </div>
            ` : '';

            const subtitleEl = card.querySelector('.entity-card-subtitle');
            if (subtitleEl) {
                subtitleEl.innerHTML = `
                    <span class="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-full px-2 py-1">
                        <span class="material-icons text-[14px]">person</span>
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
                            <span class="material-icons text-[14px]">person</span>
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
                <div class="space-y-2">
                    <div class="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap">
                        <span class="${badgeClass} rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider shadow-sm">
                            ${status}
                        </span>
                        <div class="data-badge ${sourceInfo.className}">
                            <span class="material-icons">${sourceInfo.icon}</span>
                            ${sourceInfo.label}
                        </div>
                        <div class="inline-flex items-center gap-1 text-[11px] font-medium ${syncColor} ${syncStatus === 'conflict' ? 'conflict-badge' : ''} bg-white border border-gray-100 rounded-full px-2 py-1"
                             title="${syncStatus === 'conflict' ? 'Click to resolve conflict' : `Sync Status: ${syncLabel}` }"
                             ${syncStatus === 'conflict' ? `onclick="event.stopPropagation(); window.uiManager.resolveConflict('${curation.entity_id ? 'curation' : 'entity'}', '${curation.curation_id}')"` : ''}>
                            <span class="material-icons text-[14px]">${syncIcon}</span>
                            <span class="capitalize">${syncLabel}</span>
                        </div>
                    </div>
                </div>
                <div class="grid grid-cols-3 gap-2 pt-1">
                    <button class="btn-delete-curation h-10 w-full flex items-center justify-center bg-gray-50 text-red-500 hover:bg-red-50 hover:text-red-700 rounded-lg transition-all border border-gray-100 hover:border-red-100 shadow-sm" title="Delete Curation">
                        <span class="material-icons text-[18px]">delete_outline</span>
                    </button>
                    <button class="btn-unlink-curation h-10 w-full flex items-center justify-center bg-gray-50 ${isLinkedCuration ? 'text-amber-600 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-100' : 'text-gray-300 cursor-not-allowed'} rounded-lg transition-all border border-gray-100 shadow-sm" title="Unlink Curation" ${isLinkedCuration ? '' : 'disabled'}>
                        <span class="material-icons text-[18px]">link_off</span>
                    </button>
                    <button class="btn-edit-curation h-10 w-full flex items-center justify-center bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-all border border-blue-600 shadow-sm" title="Edit Curation">
                        <span class="material-icons text-[18px]">edit</span>
                    </button>
                </div>
            `;

            // Add event listeners to buttons
            const editBtn = actionsRow.querySelector('.btn-edit-curation');
            const deleteBtn = actionsRow.querySelector('.btn-delete-curation');
            const unlinkBtn = actionsRow.querySelector('.btn-unlink-curation');

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

            if (unlinkBtn) {
                unlinkBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (window.uiManager && typeof window.uiManager.confirmUnlinkCuration === 'function') {
                        window.uiManager.confirmUnlinkCuration(curation);
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
        return div.innerHTML;
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
            <span class="material-icons text-6xl text-gray-300 mb-4">${icon}</span>
            <p class="text-gray-500 mb-2 font-medium">${title}</p>
            <p class="text-sm text-gray-400">${message}</p>
            ${action ? `
                <button class="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                    ${action.label}
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
