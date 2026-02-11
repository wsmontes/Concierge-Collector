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
            onClick = null
        } = options;

        const card = document.createElement('div');
        card.className = 'bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-lg hover:border-blue-300 transition-all duration-200 cursor-pointer group';
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
            <div class="relative">
                <!-- Header with type icon -->
                <div class="absolute top-3 right-3 flex items-center gap-2 z-10">
                    <div class="bg-white/90 backdrop-blur-sm rounded-full p-2 shadow-sm">
                        <span class="material-icons text-lg text-gray-600">${this.getTypeIcon(type)}</span>
                    </div>
                </div>
                
                <!-- Main content -->
                <div class="p-5">
                    <!-- Name and cuisine -->
                    <div class="mb-3">
                        <h3 class="font-bold text-lg text-gray-900 mb-1 pr-12 line-clamp-2 group-hover:text-blue-600 transition-colors">
                            ${name}
                        </h3>
                        ${cuisineType ? `
                            <p class="text-sm text-gray-500 font-medium">${cuisineType}</p>
                        ` : ''}
                    </div>
                    
                    <!-- Location -->
                    <div class="flex items-start gap-2 mb-3 text-sm text-gray-600">
                        <span class="material-icons text-base mt-0.5 flex-shrink-0">place</span>
                        <span class="line-clamp-2">${locationStr}</span>
                    </div>
                    
                    <!-- Rating and Price -->
                    <div class="flex items-center gap-4 mb-4">
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
                        <div class="flex items-center gap-3 pt-3 border-t border-gray-100">
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
            </div>
        `;

        // Click handler
        if (onClick) {
            card.addEventListener('click', () => onClick(entity));
        } else {
            card.addEventListener('click', () => {
                console.log('Entity clicked:', entity.entity_id);
            });
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
            }

            // Create Meta Info Row with standardized badge component
            const metaInfo = `
                <div class="flex items-center gap-2 mt-2">
                    <!-- Source Badge (Standardized) -->
                    <div class="data-badge ${sourceInfo.className}">
                        <span class="material-icons">${sourceInfo.icon}</span>
                        ${sourceInfo.label}
                    </div>
                    
                    <!-- Divider -->
                    <span class="text-gray-300 text-xs">|</span>
                    
                    <!-- Sync Status -->
                    <div class="flex items-center gap-1 ${syncColor}" title="Sync Status: ${syncStatus}">
                        <span class="material-icons text-[14px]">${syncIcon}</span>
                        <span class="text-[11px] font-medium capitalize">${syncStatus === 'pending' ? 'Syncing...' : syncStatus}</span>
                    </div>
                </div>
            `;

            actionsRow.innerHTML = `
                <div class="flex flex-col gap-1">
                    <div class="flex items-center gap-2">
                        <span class="${badgeClass} rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider shadow-sm">
                            ${status}
                        </span>
                        <div class="flex items-center gap-1 text-xs text-gray-500">
                            <span class="material-icons text-[14px]">person</span>
                            <span class="font-medium">${curatorName}</span>
                        </div>
                    </div>
                    ${metaInfo}
                </div>
                <div class="flex items-center gap-2">
                    <button class="btn-edit-curation p-2 bg-gray-50 text-gray-600 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-all border border-gray-100 hover:border-blue-100 shadow-sm" title="Edit Curation">
                        <span class="material-icons text-[20px]">edit</span>
                    </button>
                    <button class="btn-delete-curation p-2 bg-gray-50 text-red-500 hover:bg-red-50 hover:text-red-700 rounded-lg transition-all border border-gray-100 hover:border-red-100 shadow-sm" title="Delete Curation">
                        <span class="material-icons text-[20px]">delete_outline</span>
                    </button>
                </div>
            `;

            // Add event listeners to buttons
            const editBtn = actionsRow.querySelector('.btn-edit-curation');
            const deleteBtn = actionsRow.querySelector('.btn-delete-curation');

            if (editBtn) {
                editBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (window.uiManager && typeof window.uiManager.editCuration === 'function') {
                        window.uiManager.editCuration(curation);
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

            // Append actions row to the card's main content area (p-5 div)
            const contentArea = card.querySelector('.p-5');
            if (contentArea) {
                contentArea.appendChild(actionsRow);
            }
        }

        return card;
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
