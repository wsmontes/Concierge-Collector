// scripts/services/entityHydrator.js
class EntityHydrator {
  constructor({ apiService, cache, isEntityCached, scheduler } = {}) {
    this.apiService = apiService;
    this.cache = cache;
    this.isEntityCached = isEntityCached || (() => false);
    this.scheduler = scheduler || ((fn) => (typeof requestIdleCallback !== 'undefined'
      ? requestIdleCallback(fn) : setTimeout(fn, 0)));
    this.queue = [];
    this.seen = new Set();
    this.running = false;
    this.paused = false;
  }

  enqueue(entityIds = []) {
    for (const id of entityIds) {
      if (!id || this.seen.has(id) || this.isEntityCached(id)) continue;
      this.seen.add(id);
      this.queue.push(id);
    }
  }

  async processNext() {
    if (!this.queue.length) return false;
    const id = this.queue.shift();
    try {
      const entity = await this.apiService.getEntity(id);
      if (entity) await this.cache.putEntity(entity);
    } catch (_) { /* mantém a fila viva */ }
    return true;
  }

  async processAll() {
    while (await this.processNext()) { /* drena */ }
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      if (this.paused) { this.running = false; return; }
      const more = await this.processNext();
      if (more) this.scheduler(tick); else this.running = false;
    };
    this.scheduler(tick);
  }

  pause() { this.paused = true; }
}

export { EntityHydrator };
