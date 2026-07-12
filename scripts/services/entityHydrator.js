// scripts/services/entityHydrator.js
const MAX_SEEN = 5000; // bound dedup set to prevent unbounded memory growth

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

  async enqueue(entityIds = []) {
    for (const id of entityIds) {
      if (!id || this.seen.has(id)) continue;
      // isEntityCached may be sync or async — await handles both
      if (await this.isEntityCached(id)) continue;
      if (this.seen.size >= MAX_SEEN) {
        // Reset dedup set to prevent unbounded memory; acceptable to
        // re-enqueue entities that were seen long ago.
        this.seen.clear();
      }
      this.seen.add(id);
      this.queue.push(id);
    }
  }

  async processNext() {
    if (!this.queue.length) return false;
    const id = this.queue.shift();
    try {
      const entity = await this.apiService.getEntity(id);
      if (entity) { await this.cache.putEntity(entity); return true; }
    } catch (_) {
      // Transient error — re-enqueue for one retry
      if (!this.seen.has(id + ':retried')) {
        this.seen.add(id + ':retried');
        this.queue.push(id);
      }
    }
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
