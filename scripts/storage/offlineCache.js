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

  estimateBytes(obj) {
    try { return JSON.stringify(obj).length; } catch (_) { return 500; }
  }

  async putCurations(items, now = Date.now()) {
    for (const item of items) {
      // Use curation_id for lookup (API returns _id and curation_id, not id)
      const lookupKey = item.curation_id || item._id || item.id;
      const existing = lookupKey ? await this.db.curations.where('curation_id').equals(lookupKey).first() : null;
      const record = {
        ...(existing || {}),
        ...item,
        lastAccessedAt: now,
        source: existing?.source === 'owned' ? 'owned' : 'cache',
      };
      // Preserve the Dexie auto-generated id if the record was already cached
      if (existing?.id) record.id = existing.id;
      await this.db.curations.put(record);
    }
    await this.enforceBudget(now);
  }

  async putEntity(entity, now = Date.now()) {
    const existing = await this.db.entities.get(entity.id);
    await this.db.entities.put({
      ...existing, ...entity, lastAccessedAt: now,
      source: existing?.source === 'owned' ? 'owned' : 'cache',
    });
  }

  async touch(id, now = Date.now()) {
    await this.db.curations.update(id, { lastAccessedAt: now });
  }

  isDirty(rec) {
    const s = rec?.sync?.status;
    return rec?.source === 'owned' || s === 'pending' || s === 'conflict';
  }

  async markCurationOwned(curationId, apiService) {
    const cur = await this.db.curations.get(curationId)
      || await this.db.curations.where('curation_id').equals(curationId).first();
    if (!cur) return;
    await this.db.curations.update(cur.id, { source: 'owned' });
    if (cur.entity_id) {
      const ent = await this.db.entities.where('entity_id').equals(cur.entity_id).first();
      if (!ent) {
        const fetched = await apiService.getEntity(cur.entity_id);
        if (fetched) await this.db.entities.put({ ...fetched, source: 'owned' });
      } else {
        await this.db.entities.update(ent.id, { source: 'owned' });
      }
    }
  }

  async enforceBudget(now = Date.now()) {
    const { maxBytes } = await this.budget.getBudget();
    const all = await this.db.curations.toArray();
    let currentBytes = 0;
    const items = all.map(rec => {
      const bytes = this.estimateBytes(rec);
      currentBytes += bytes;
      return { id: rec.id, bytes, lastAccessedAt: rec.lastAccessedAt || 0, dirty: this.isDirty(rec) };
    });
    const evict = this.selectEvictions(items, currentBytes, maxBytes);
    for (const id of evict) {
      const rec = await this.db.curations.get(id);
      await this.db.curations.delete(id);
      // remove entidade órfã (nenhuma outra curadoria a referencia)
      if (rec?.entity_id) {
        const others = await this.db.curations.where('entity_id').equals(rec.entity_id).count();
        if (others === 0) {
          const ent = await this.db.entities.where('entity_id').equals(rec.entity_id).first();
          if (ent && !this.isDirty(ent)) await this.db.entities.delete(ent.id);
        }
      }
    }
  }
}

export { OfflineCache };
