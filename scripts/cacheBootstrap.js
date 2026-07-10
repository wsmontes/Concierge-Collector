// scripts/cacheBootstrap.js -- carregado como <script type="module">
import { StorageBudget } from './storage/storageBudget.js';
import { OfflineCache } from './storage/offlineCache.js';
import { EntityHydrator } from './services/entityHydrator.js';
import { CurationBrowser } from './services/curationBrowser.js';

async function waitFor(getter, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = getter();
    if (v) return v;
    await new Promise(r => setTimeout(r, 50));
  }
  return getter();
}

async function initCollectorCache() {
  await waitFor(() => window.DataStore && window.DataStore.db);
  await waitFor(() => window.ApiService);
  const budget = new StorageBudget();
  const cache = new OfflineCache({ db: window.DataStore.db, budget });
  const hydrator = new EntityHydrator({
    apiService: window.ApiService,
    cache,
    isEntityCached: async (id) =>
      !!(await window.DataStore.db.entities.where('entity_id').equals(id).first()),
  });
  const browser = new CurationBrowser({ apiService: window.ApiService, cache, hydrator });
  window.OfflineCache = cache;
  window.EntityHydrator = hydrator;
  hydrator.start();
  window.CurationBrowser = browser;
  window.dispatchEvent(new CustomEvent('collector-cache-ready'));
}

initCollectorCache();
