/*
 * SyncSemanticPolicy
 *
 * Sync transports durable domain state; it does not reconstruct domain truth.
 * Linkage comes from entity_id, authorship from curator_type, and provenance
 * from explicit sources. Legacy `status=linked` is normalized to draft only.
 */
(function exposeSyncSemanticPolicy(global) {
    'use strict';

    class SyncSemanticPolicy {
        static normalizeStatus(status, { defaultDraft = true } = {}) {
            if (status === undefined || status === null || status === '') {
                return defaultDraft ? 'draft' : undefined;
            }
            const value = String(status).toLowerCase();
            return value === 'linked' ? 'draft' : status;
        }

        static createdAt(curation) {
            const value = curation?.created_at || curation?.createdAt || null;
            if (!value) return null;
            try {
                return new Date(value).toISOString();
            } catch (_) {
                return null;
            }
        }

        static normalizeSources(curation = {}) {
            const current = curation.sources;
            if (current && typeof current === 'object' && !Array.isArray(current)) {
                return current;
            }

            const createdAt = this.createdAt(curation);
            if (Array.isArray(current)) {
                const mapped = {};
                // The legacy array itself is explicit provenance. Transcript
                // text is copied only after `audio` was explicitly declared.
                if (current.includes('audio')) {
                    mapped.audio = [{
                        source_id: curation.transcription_id || null,
                        transcript: curation.transcript || curation.unstructured_text || curation.transcription || null,
                        created_at: createdAt
                    }];
                }
                if (current.includes('image')) mapped.image = [{ created_at: createdAt }];
                if (current.includes('google_places')) mapped.google_places = [{ created_at: createdAt }];
                if (current.includes('import')) mapped.import = [{ created_at: createdAt }];
                if (current.includes('web_research')) mapped.web_research = [];
                if (current.includes('manual') || Object.keys(mapped).length === 0) {
                    mapped.manual = [{ created_at: createdAt }];
                }
                return mapped;
            }

            // No explicit provenance: manual is the only safe transport
            // fallback. Transcript contents never prove voice capture.
            return { manual: [{ created_at: createdAt }] };
        }

        static cleanCuration(curation = {}, curatorPayload = null) {
            const curator = curatorPayload || curation.curator || {
                id: curation.curator_id || 'unknown',
                name: curation.curator_id || 'unknown',
                email: null
            };
            const cleaned = {
                curation_id: curation.curation_id,
                curator_id: curator.id || curation.curator_id || 'unknown',
                curator,
                curator_type: curation.curator_type === 'synthetic' ? 'synthetic' : 'human',
                createdBy: curation.createdBy,
                updatedBy: curation.updatedBy,
                restaurant_name: curation.restaurant_name || curation.name || null,
                status: this.normalizeStatus(curation.status),
                categories: curation.categories || {},
                notes: curation.notes || {},
                transcript: curation.transcript || curation.unstructured_text || curation.transcription || null,
                sources: this.normalizeSources(curation),
                items: curation.items || []
            };
            if (curation.entity_id) cleaned.entity_id = curation.entity_id;
            if (curation.version !== undefined) cleaned.version = curation.version;
            return cleaned;
        }

        static sanitizePatch(payload = {}) {
            const sanitized = { ...payload };
            for (const key of ['id', 'sync', '_lastSyncedState', 'etag', 'version']) {
                delete sanitized[key];
            }
            if (!sanitized.curator_id && sanitized.curator?.id) {
                sanitized.curator_id = sanitized.curator.id;
            }
            if (Object.prototype.hasOwnProperty.call(sanitized, 'status')) {
                sanitized.status = this.normalizeStatus(sanitized.status, { defaultDraft: false });
                if (sanitized.status === undefined) delete sanitized.status;
            }
            if (Object.prototype.hasOwnProperty.call(sanitized, 'sources')) {
                sanitized.sources = this.normalizeSources({ ...payload, sources: sanitized.sources });
            }
            return sanitized;
        }

        static installSyncManagerGuards(runtime = global) {
            const Klass = runtime.SyncManagerV3;
            const proto = Klass?.prototype;
            if (!proto || proto.__syncSemanticPolicyInstalled) {
                return Boolean(proto?.__syncSemanticPolicyInstalled);
            }
            proto.__syncSemanticPolicyInstalled = true;

            proto.cleanCurationForSync = function (curation) {
                const curator = typeof this.buildCuratorPayload === 'function'
                    ? this.buildCuratorPayload(curation)
                    : null;
                return SyncSemanticPolicy.cleanCuration(curation, curator);
            };

            proto.sanitizeCurationPatchPayload = function (payload) {
                return SyncSemanticPolicy.sanitizePatch(payload);
            };

            if (typeof proto.extractChangedFields === 'function') {
                const originalExtractChangedFields = proto.extractChangedFields;
                proto.extractChangedFields = function (item, original = null) {
                    const changes = originalExtractChangedFields.call(this, item, original);
                    if (item?.curation_id) return SyncSemanticPolicy.sanitizePatch(changes);
                    return changes;
                };
            }
            return true;
        }

        static startInstall(runtime = global, attempt = 0) {
            if (this.installSyncManagerGuards(runtime)) return true;
            if (attempt >= 300 || !runtime.document) return false;
            runtime.setTimeout?.(
                () => this.startInstall(runtime, attempt + 1),
                100
            );
            return false;
        }
    }

    global.SyncSemanticPolicy = SyncSemanticPolicy;
    if (global.document) {
        SyncSemanticPolicy.startInstall(global);
    }
})(window);
