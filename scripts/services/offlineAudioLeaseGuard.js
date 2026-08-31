/*
 * OfflineAudioLeaseGuard
 *
 * PendingAudioManager owns the persistent claim. This guard protects the next
 * boundary: materializing claimed text into a durable draft/Curation. It
 * revalidates the exact lease immediately before the write and runs the
 * read/modify/write in an IndexedDB transaction so audio and photo background
 * processors cannot last-write-win the same authoring records across tabs.
 */
(function exposeOfflineAudioLeaseGuard(global) {
    'use strict';

    class OfflineAudioLeaseGuard {
        constructor(runtime = global) {
            this.runtime = runtime;
            this.log = runtime.Logger?.module?.('OfflineAudioLeaseGuard') || console;
            this._installedProcessor = null;
            this._assignmentHookInstalled = false;
            this._timer = null;
        }

        _leaseExpiryMs(row) {
            if (!row?.processingLeaseExpiresAt) return 0;
            const value = new Date(row.processingLeaseExpiresAt).getTime();
            return Number.isFinite(value) ? value : 0;
        }

        _leaseIsActive(row, now = Date.now()) {
            return Boolean(row?.processingLeaseToken && this._leaseExpiryMs(row) > now);
        }

        _leaseLostError() {
            const error = new Error('Pending audio processing lease was lost before materialization');
            error.name = 'ProcessingLeaseLostError';
            return error;
        }

        async _resolvePending(audio) {
            const manager = this.runtime.PendingAudioManager;
            if (!manager?.resolveAudio || !audio) return null;
            const locator = audio.id ?? audio.sourceId;
            return manager.resolveAudio(locator);
        }

        async _assertLeaseDirect(audio) {
            const token = audio?.processingLeaseToken || null;
            if (!token) return true; // compatibility for pre-lease/manual rows
            const current = await this._resolvePending(audio);
            if (!current || current.processingLeaseToken !== token || !this._leaseIsActive(current)) {
                throw this._leaseLostError();
            }
            return true;
        }

        async _withTransaction(kind, task) {
            const db = this.runtime.DataStore?.db;
            const pending = db?.pendingAudio;
            const target = kind === 'curation' ? db?.curations : db?.draftRestaurants;
            if (!target) return task();
            // Overlapping RW transactions on `curations` serialize against the
            // photo guard as well; both background media pipelines therefore
            // observe the latest Curation before merging provenance/categories.
            if (typeof db?.transaction === 'function' && pending) {
                return db.transaction('rw', pending, target, task);
            }
            if (typeof db?.transaction === 'function') return db.transaction('rw', target, task);
            return task();
        }

        install(processor = this.runtime.offlineCaptureProcessor) {
            if (!processor?.materializeIntoCuration || !processor?.materializeIntoDraft || !processor?.processAudio) return false;
            if (processor.__offlineAudioLeaseGuardInstalled) {
                this._installedProcessor = processor;
                return true;
            }

            const guard = this;
            const originalCuration = processor.materializeIntoCuration.bind(processor);
            const originalDraft = processor.materializeIntoDraft.bind(processor);
            const originalProcessAudio = processor.processAudio.bind(processor);

            processor.__offlineAudioLeaseGuardInstalled = true;
            processor.__offlineAudioLeaseOriginalMaterializeCuration = originalCuration;
            processor.__offlineAudioLeaseOriginalMaterializeDraft = originalDraft;
            processor.__offlineAudioLeaseOriginalProcessAudio = originalProcessAudio;

            processor.materializeIntoCuration = (audio, ...args) => guard._withTransaction('curation', async () => {
                await guard._assertLeaseDirect(audio);
                return originalCuration(audio, ...args);
            });

            processor.materializeIntoDraft = (audio, ...args) => guard._withTransaction('draft', async () => {
                await guard._assertLeaseDirect(audio);
                return originalDraft(audio, ...args);
            });

            processor.processAudio = async (audio, ...args) => {
                try {
                    return await originalProcessAudio(audio, ...args);
                } catch (error) {
                    if (error?.name !== 'ProcessingLeaseLostError') throw error;
                    guard.log.warn(`Audio lease lost for ${audio?.sourceId || audio?.id || 'capture'}; stale worker skipped`);
                    return { status: 'skipped', sourceId: audio?.sourceId || null, error };
                }
            };

            this._installedProcessor = processor;
            return true;
        }

        installAssignmentHook() {
            if (this._assignmentHookInstalled) return true;
            const runtime = this.runtime;
            const name = 'offlineCaptureProcessor';
            const descriptor = Object.getOwnPropertyDescriptor(runtime, name);
            if (descriptor && descriptor.configurable === false) return false;

            let value = runtime[name] || null;
            const guard = this;
            Object.defineProperty(runtime, name, {
                configurable: true,
                enumerable: true,
                get() { return value; },
                set(next) {
                    value = next;
                    if (next) guard.install(next);
                }
            });
            this._assignmentHookInstalled = true;
            if (value) this.install(value);
            return true;
        }

        _pollInstall(attempt = 0) {
            if (this.install()) return;
            if (attempt >= 300) {
                this.log.warn('Audio materialization lease guard could not attach');
                return;
            }
            clearTimeout(this._timer);
            this._timer = this.runtime.setTimeout?.(() => this._pollInstall(attempt + 1), 100);
        }

        start() {
            // When loaded before OfflineCaptureProcessor, the assignment hook
            // installs synchronously after processor.start() returns but before
            // its setTimeout(0) reconnect processing can run.
            this.installAssignmentHook();
            this._pollInstall();
            return this;
        }
    }

    global.OfflineAudioLeaseGuard = OfflineAudioLeaseGuard;
    if (global.document && !global.offlineAudioLeaseGuard) {
        global.offlineAudioLeaseGuard = new OfflineAudioLeaseGuard(global).start();
    }
})(window);
