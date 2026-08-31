/*
 * LocalEntitySearch
 *
 * Offline-first search over the Entity working set already cached in Dexie.
 * This service never calls the network. It exists so authoring/linking can
 * continue when Google Places and the API are unavailable.
 */
(function exposeLocalEntitySearch(global) {
    'use strict';

    class LocalEntitySearch {
        constructor(dataStore = global.DataStore || global.dataStore || null) {
            this.dataStore = dataStore;
            this.defaultLimit = 100;
        }

        normalize(value) {
            return String(value || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .trim();
        }

        extractCity(entity) {
            return entity?.city ||
                entity?.data?.location?.city ||
                entity?.data?.address?.city ||
                '';
        }

        searchableText(entity) {
            return this.normalize([
                entity?.name,
                entity?.restaurant_name,
                this.extractCity(entity),
                entity?.data?.address?.street,
                entity?.data?.formattedAddress,
                entity?.data?.address?.formattedAddress
            ].filter(Boolean).join(' '));
        }

        score(entity, query) {
            if (!query) return 0;
            const name = this.normalize(entity?.name || entity?.restaurant_name || '');
            if (name === query) return 100;
            if (name.startsWith(query)) return 75;
            if (name.includes(query)) return 50;
            if (this.searchableText(entity).includes(query)) return 25;
            return 0;
        }

        async search(query = '', filters = {}) {
            const table = this.dataStore?.db?.entities;
            if (!table?.toArray) return [];

            const normalizedQuery = this.normalize(query);
            const normalizedCity = this.normalize(filters.city || '');
            const normalizedType = this.normalize(filters.type || '');
            const limit = Math.max(1, Math.min(Number(filters.limit || this.defaultLimit), 250));
            const rows = await table.toArray();

            return rows
                .filter((entity) => {
                    if (!entity?.entity_id) return false;
                    if (String(entity.status || 'active').toLowerCase() === 'deleted') return false;

                    const type = this.normalize(entity.type || entity.data?.type || 'restaurant');
                    if (normalizedType && normalizedType !== 'all' && type !== normalizedType) return false;

                    const city = this.normalize(this.extractCity(entity));
                    if (normalizedCity && normalizedCity !== 'all' && city !== normalizedCity) return false;

                    if (normalizedQuery && !this.searchableText(entity).includes(normalizedQuery)) return false;
                    return true;
                })
                .map((entity) => ({ entity, score: this.score(entity, normalizedQuery) }))
                .sort((a, b) => b.score - a.score || String(a.entity.name || '').localeCompare(String(b.entity.name || '')))
                .slice(0, limit)
                .map(({ entity }) => entity);
        }
    }

    global.LocalEntitySearch = LocalEntitySearch;
})(window);
