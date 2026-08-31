/*
 * CurationOwnershipPolicy
 *
 * Pure local policy used before entering a mutable Curation editor. The
 * server remains the final authority, but offline UX must not allow work that
 * is guaranteed to be rejected after reconnect.
 */
(function exposeCurationOwnershipPolicy(global) {
    'use strict';

    class CurationOwnershipPolicy {
        static ownerId(curation) {
            const embedded = curation?.curator?.id;
            const explicit = curation?.curator_id;
            if (explicit && explicit !== 'unknown') return String(explicit);
            if (embedded && embedded !== 'unknown') return String(embedded);
            return null;
        }

        static curatorType(curation) {
            return curation?.curator_type === 'synthetic' ? 'synthetic' : 'human';
        }

        static decide(curation, editorId) {
            const ownerId = this.ownerId(curation);
            const curatorType = this.curatorType(curation);
            const normalizedEditor = editorId ? String(editorId) : null;

            if (curatorType === 'synthetic') {
                return { action: 'takeover', ownerId, curatorType };
            }

            // Legacy records with no usable owner cannot be conclusively
            // rejected locally; allow the server ownership contract to decide.
            if (!ownerId || !normalizedEditor || ownerId === normalizedEditor) {
                return { action: 'edit', ownerId, curatorType };
            }

            return { action: 'create-own', ownerId, curatorType };
        }
    }

    global.CurationOwnershipPolicy = CurationOwnershipPolicy;
})(window);
