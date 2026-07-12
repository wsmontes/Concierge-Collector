// scripts/storage/storageBudget.js
class StorageBudget {
  constructor({ storage = (typeof navigator !== 'undefined' ? navigator.storage : undefined),
                deviceMemory = (typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined),
                config = {} } = {}) {
    this.storage = storage;
    this.deviceMemory = deviceMemory;
    this.maxAbsoluteBytes = config.maxAbsoluteBytes ?? 200 * 1024 * 1024;
    this.freeFraction = config.freeFraction ?? 0.5;
    this.lowMemoryBytes = config.lowMemoryBytes ?? 50 * 1024 * 1024;
  }

  async getBudget() {
    let quota = 0, usage = 0;
    if (this.storage && typeof this.storage.estimate === 'function') {
      try { const e = await this.storage.estimate(); quota = e.quota || 0; usage = e.usage || 0; } catch (_) {}
    }
    const free = Math.max(0, quota - usage);
    let budget = Math.floor(free * this.freeFraction);
    // budget may be 0 legitimately (disk full) — only fall back when
    // the estimate API was unavailable (both quota and usage are 0).
    if (quota === 0 && usage === 0) budget = this.maxAbsoluteBytes;
    budget = Math.min(budget, this.maxAbsoluteBytes);
    if (typeof this.deviceMemory === 'number' && this.deviceMemory <= 2) {
      budget = Math.min(budget, this.lowMemoryBytes);
    }
    return { maxBytes: budget };
  }
}

export { StorageBudget };
if (typeof window !== 'undefined') { window.StorageBudget = new StorageBudget(); }
