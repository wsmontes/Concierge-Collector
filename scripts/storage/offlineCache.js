// scripts/storage/offlineCache.js
class OfflineCache {
  constructor({ db, budget } = {}) {
    this.db = db;
    this.budget = budget;
  }

  /** Seleção pura de evicção: mais antigos e limpos primeiro, até caber. */
  selectEvictions(items, currentBytes, maxBytes) {
    if (currentBytes <= maxBytes) return [];
    const clean = items
      .filter(i => !i.dirty)
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    const toEvict = [];
    let bytes = currentBytes;
    for (const item of clean) {
      if (bytes <= maxBytes) break;
      toEvict.push(item.id);
      bytes -= item.bytes;
    }
    return toEvict;
  }
}

export { OfflineCache };
