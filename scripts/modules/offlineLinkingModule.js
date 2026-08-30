/*
 * OfflineLinkingModule
 *
 * Makes FindEntityModal selection mode local-first. Browsing/importing Google
 * Places remains online-only, but linking a Curation to an Entity already in
 * the local working set never requires the network.
 */
(function exposeOfflineLinking(global) {
    'use strict';

    class OfflineLinkingModule {
        constructor() {
            this.log = global.Logger?.module?.('OfflineLinking') || console;
            this.localSearch = global.LocalEntitySearch ? new global.LocalEntitySearch(global.DataStore || global.dataStore) : null;
            this._installed = false;
            this._timer = null;
        }

        start() {
            this._pollInstall();
            return this;
        }

        _pollInstall(attempt = 0) {
            if (this.install()) return;
            if (attempt >= 300) {
                this.log.warn('FindEntityModal did not become available for offline linking');
                return;
            }
            clearTimeout(this._timer);
            this._timer = setTimeout(() => this._pollInstall(attempt + 1), 100);
        }

        install() {
            const ModalClass = global.FindEntityModal;
            const proto = ModalClass?.prototype;
            if (!proto?.performSearch || proto.__offlineLinkingInstalled) {
                return Boolean(proto?.__offlineLinkingInstalled);
            }

            if (!this.localSearch && global.LocalEntitySearch) {
                this.localSearch = new global.LocalEntitySearch(global.DataStore || global.dataStore);
            }
            if (!this.localSearch) return false;

            const module = this;
            const originalPerformSearch = proto.performSearch;
            proto.__offlineLinkingInstalled = true;
            proto.__offlineLinkingOriginalPerformSearch = originalPerformSearch;

            proto.performSearch = async function (...args) {
                // Normal Google Places browsing/import stays untouched. The
                // local-first contract applies only when the modal is being
                // used as a Curation -> Entity selector.
                if (!this.onEntitySelected || typeof this.onEntitySelected !== 'function') {
                    return originalPerformSearch.apply(this, args);
                }
                return module.searchLocalFirst(this, originalPerformSearch, args);
            };

            this._installed = true;
            return true;
        }

        entityPlaceId(entity) {
            return String(
                entity?.data?.google_place_id ||
                entity?.data?.place_id ||
                entity?.externalId ||
                ''
            ).trim();
        }

        remotePlaceId(place) {
            return String(place?.place_id || place?.id || '').replace(/^places\//, '').trim();
        }

        mergeLocalAndRemote(localEntities, remotePlaces) {
            const localPlaceIds = new Set(localEntities.map((entity) => this.entityPlaceId(entity)).filter(Boolean));
            const localEntityIds = new Set(localEntities.map((entity) => String(entity?.entity_id || '')).filter(Boolean));
            const remote = (remotePlaces || []).filter((place) => {
                const placeId = this.remotePlaceId(place);
                if (placeId && localPlaceIds.has(placeId)) return false;
                const candidateEntityId = placeId ? `entity_${placeId}` : '';
                return !candidateEntityId || !localEntityIds.has(candidateEntityId);
            });
            return { local: localEntities, remote };
        }

        async searchLocalFirst(modal, originalPerformSearch, args = []) {
            modal.updateFiltersFromUI?.();
            const query = modal.searchInput?.value?.trim?.() || '';
            const localEntities = await this.localSearch.search(query, {
                type: modal.filters?.type || 'all',
                limit: 100
            });

            if (global.navigator?.onLine === false) {
                this.renderResults(modal, { local: localEntities, remote: [] }, true);
                return { local: localEntities, remote: [], offline: true };
            }

            // Render local results immediately, then enrich with remote
            // Google matches. This keeps the selector responsive even on a
            // slow connection and makes cached Entities the first-class path.
            this.renderResults(modal, { local: localEntities, remote: [] }, false, { loadingRemote: true });

            try {
                await originalPerformSearch.apply(modal, args);
            } catch (error) {
                this.log.warn('Remote Entity search failed; keeping local results:', error);
            }

            const remotePlaces = Array.isArray(modal.currentResults) ? modal.currentResults : [];
            const merged = this.mergeLocalAndRemote(localEntities, remotePlaces);
            this.renderResults(modal, merged, false);
            return { ...merged, offline: false };
        }

        localCard(modal, entity) {
            const esc = (value) => modal.escapeHtml?.(value) ?? String(value || '');
            const address = entity?.data?.formattedAddress ||
                entity?.data?.address?.formattedAddress ||
                entity?.data?.address?.street ||
                entity?.city ||
                entity?.data?.address?.city ||
                '';
            const type = entity?.type || 'restaurant';
            return `
                <div class="fem-place-card fem-local-entity-card" data-local-entity-card="${esc(entity.entity_id)}">
                    <div class="fem-place-card-body">
                        <div class="fem-place-icon"><span class="material-icons">place</span></div>
                        <div class="fem-place-info">
                            <h3 class="fem-place-name">${esc(entity.name || entity.restaurant_name || 'Unknown')}</h3>
                            <p class="fem-place-address">${esc(address || 'Saved locally')}</p>
                            <div class="fem-place-meta">
                                <span class="fem-place-badge fem-badge-open">Local Entity</span>
                                <span class="fem-place-badge">${esc(type)}</span>
                            </div>
                        </div>
                    </div>
                    <button class="fem-import-btn fem-btn-select fem-local-select" data-local-entity-id="${esc(entity.entity_id)}">
                        <span class="material-icons">check_circle</span>
                        Select
                    </button>
                </div>
            `;
        }

        renderResults(modal, merged, localOnly = false, { loadingRemote = false } = {}) {
            const local = merged?.local || [];
            const remote = merged?.remote || [];
            const total = local.length + remote.length;

            modal.showLoading?.(false);
            if (!modal.resultsContainer) return;

            if (!total && localOnly) {
                modal.showEmptyState?.('No local matches', 'Local only — connect to search the full Entity catalog and Google Places.');
                return;
            }
            if (!total && !loadingRemote) {
                modal.showEmptyState?.('No results found', 'Try another name, or connect to search more places.');
                return;
            }

            const remoteHtml = remote.map((place) => modal.createPlaceCard(place)).join('');
            modal.resultsContainer.innerHTML = `
                <div class="fem-results-count">
                    <strong>${total}</strong> ${total === 1 ? 'match' : 'matches'}
                    ${localOnly ? '<span> · Local only</span>' : (loadingRemote ? '<span> · checking online…</span>' : '')}
                </div>
                <div class="fem-results-grid">
                    ${local.map((entity) => this.localCard(modal, entity)).join('')}
                    ${remoteHtml}
                </div>
            `;

            const localById = new Map(local.map((entity) => [String(entity.entity_id), entity]));
            modal.resultsContainer.querySelectorAll('.fem-local-select').forEach((button) => {
                button.addEventListener('click', async (event) => {
                    const entityId = event.currentTarget.getAttribute('data-local-entity-id');
                    const entity = localById.get(String(entityId));
                    if (entity) await this.selectLocalEntity(modal, entity);
                });
            });
            modal.attachImportHandlers?.();
        }

        async selectLocalEntity(modal, entity) {
            if (!entity || typeof modal?.onEntitySelected !== 'function') return false;
            const callback = modal.onEntitySelected;
            modal.close?.();
            await callback(entity);
            modal.onEntitySelected = null;
            return true;
        }
    }

    global.OfflineLinkingModule = OfflineLinkingModule;
    if (!global.offlineLinking) {
        global.offlineLinking = new OfflineLinkingModule();
        global.offlineLinking.start();
    }
})(window);
