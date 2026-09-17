export interface paths {
    "/api/v3/auth/cms/authorize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Authorize
         * @description Issue a one-shot code for a current admin and redirect to the fixed CMS callback.
         */
        get: operations["authorize_api_v3_auth_cms_authorize_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v3/auth/cms/exchange": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Exchange
         * @description Atomically consume a one-shot code on behalf of the CMS server.
         */
        post: operations["exchange_api_v3_auth_cms_exchange_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v3/auth/cms/introspect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Introspect
         * @description Return the live authorization for an already-authenticated CMS subject.
         */
        post: operations["introspect_api_v3_auth_cms_introspect_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v3/auth/cms/introspect-bearer": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Introspect Bearer
         * @description Revalidate a Collector Bearer for the narrow CMS bridge.
         *
         *     This is not a general token exchange: it accepts only an interactive
         *     session and only returns a currently authorized admin identity.
         */
        post: operations["introspect_bearer_api_v3_auth_cms_introspect_bearer_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v3/catalog/content-health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Read Content Health
         * @description Editorial counters for the Admin overview, over non-deleted Curations.
         */
        post: operations["read_content_health_api_v3_catalog_content_health_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v3/catalog/curations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Search Curations */
        get: operations["search_curations_api_v3_catalog_curations_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v3/catalog/curations/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Resolve Curation Selection
         * @description Resolve an explicit selection for a currently authorized CMS admin.
         */
        post: operations["resolve_curation_selection_api_v3_catalog_curations_resolve_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v3/catalog/curations/scan/page": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Scan Page */
        post: operations["scan_page_api_v3_catalog_curations_scan_page_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v3/catalog/curations/scan/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start Scan */
        post: operations["start_scan_api_v3_catalog_curations_scan_start_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v3/catalog/curations/summaries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Read Curation Summaries
         * @description The Admin list row of many Curations in one query, in the requested order.
         *
         *     Humanizes Collection members and draft diffs. Ids that do not exist are
         *     omitted instead of rejected, so a stale membership renders as nothing.
         */
        post: operations["read_curation_summaries_api_v3_catalog_curations_summaries_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v3/catalog/curations/{curation_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update Curation Record
         * @description Update any editable root key of a stored Curation.
         *
         *     The domain update pipeline runs unchanged — ownership, version CAS,
         *     entity denormalization and embeddings bookkeeping included — with the CMS
         *     actor as its author. Returns the complete updated document, JSON-safe.
         */
        patch: operations["update_curation_record_api_v3_catalog_curations__curation_id__patch"];
        trace?: never;
    };
    "/api/v3/catalog/curations/{curation_id}/record": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read Curation Record
         * @description Return the complete stored Curation document, JSON-safe.
         */
        get: operations["read_curation_record_api_v3_catalog_curations__curation_id__record_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v3/catalog/curators": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Catalog Curators
         * @description Search the curator directory by name or email, ordered by name.
         *
         *     ``q`` is text, not a pattern: regex metacharacters match themselves. Without
         *     ``q`` the page is still bounded by ``limit``, so browsing never becomes a
         *     whole-collection read.
         */
        get: operations["list_catalog_curators_api_v3_catalog_curators_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v3/catalog/entities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Stored Entities
         * @description Page the stored Entity collection ordered by ``_id`` ascending.
         *
         *     ``q`` matches ``name``, ``entity_id`` or ``externalId`` case-insensitively.
         *     ``after_id`` is the ``id`` of the last row of the previous page; when a page
         *     comes back full, its last ``id`` is returned as ``next_cursor``.
         */
        get: operations["list_stored_entities_api_v3_catalog_entities_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v3/catalog/entities/{entity_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update Entity Record
         * @description Update any editable root key of a stored Entity.
         *
         *     Same pipeline as the domain PATCH (ordered CAS probe, linked-Curation
         *     denormalization) and the same ``If-Match`` convention: 428 when the header
         *     is missing, 409 on a version conflict.
         */
        patch: operations["update_entity_record_api_v3_catalog_entities__entity_id__patch"];
        trace?: never;
    };
    "/api/v3/catalog/entities/{entity_id}/curations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Entity Curations
         * @description Every stored Curation attached to the Entity, newest ``updatedAt`` first.
         *
         *     ``after_id`` is the ``id`` of the last Curation of the previous page; the
         *     anchor is resolved back to its ``(updatedAt, _id)`` position, so paging
         *     stays consistent while the collection is written to.
         */
        get: operations["list_entity_curations_api_v3_catalog_entities__entity_id__curations_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v3/catalog/entities/{entity_id}/image": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read Entity Image
         * @description The reencoded JPEG of one ranked Entity image.
         *
         *     Rank 0 (the thumbnail the Admin renders) serves the Entity's persisted
         *     display media — the resolution that used to be redone on every render is now
         *     a stored fact, and this route only fetches the opaque reference it stored.
         *     With no fresh fact the response is a short-cached 404 and the enrichment is
         *     scheduled in the background, never awaited.
         *
         *     Ranks 1..7 keep the ranked collector path: the gallery is on demand and the
         *     pipeline already caches its catalog in memory.
         */
        get: operations["read_entity_image_api_v3_catalog_entities__entity_id__image_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v3/catalog/entities/{entity_id}/images": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read Entity Images
         * @description The ranked images of one Entity, ascending by rank, bounded by the ceiling.
         *
         *     An Entity with sources but no usable image is an empty gallery, not an
         *     error: the Admin needs the honest "no image" state, not a failure it would
         *     have to guess about.
         */
        get: operations["read_entity_images_api_v3_catalog_entities__entity_id__images_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v3/catalog/entities/{entity_id}/record": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read Entity Record
         * @description Return the complete stored Entity document, JSON-safe.
         *
         *     Every stored key is returned except the API's own derived ones
         *     (``ENTITY_INTERNAL_FIELDS``) — the inspector renders raw fields, and the
         *     display media fact is not editorial content.
         */
        get: operations["read_entity_record_api_v3_catalog_entities__entity_id__record_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v3/curations/{curation_id}/collections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Published Associations
         * @description List only the currently published associations of a Curation.
         *
         *     The curation must still exist, while association visibility is solely
         *     governed by the version interval and the Collection publication state.
         */
        get: operations["published_associations_api_v3_curations__curation_id__collections_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v3/internal/curations/hydrate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Hydrate Curations */
        post: operations["hydrate_curations_api_v3_internal_curations_hydrate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** AdminCurationRow */
        AdminCurationRow: {
            /**
             * Audio Count
             * @description Length of ``sources.audio`` (null when it is not a list).
             */
            audio_count?: number | null;
            /** Catalog Sequence */
            catalog_sequence: number;
            /** City */
            city?: string | null;
            /**
             * Concepts
             * @description Every concept value stored under ``categories``, de-duplicated and capped — null when ``categories`` is not a stored mapping.
             */
            concepts?: string[] | null;
            /**
             * Created At
             * @description Stored ``createdAt`` (null when the document has none).
             */
            created_at?: string | null;
            /** Curation Id */
            curation_id: string;
            /** Curator Id */
            curator_id?: string | null;
            /**
             * Curator Name
             * @description Stored ``curator.name`` (null when the document has none).
             */
            curator_name?: string | null;
            /** Entity Type */
            entity_type?: string | null;
            /**
             * Has Transcript
             * @description True only when ``transcript`` is a non-empty string.
             * @default false
             */
            has_transcript: boolean;
            /**
             * Image Count
             * @description Length of ``sources.image`` (null when it is not a list).
             */
            image_count?: number | null;
            /** Restaurant Name */
            restaurant_name?: string | null;
            /**
             * Source Count
             * @description Keys in the stored ``sources`` mapping (null when it is not a mapping).
             */
            source_count?: number | null;
            /** Status */
            status: string;
            /** Updated At */
            updated_at?: string | null;
            /**
             * Version
             * @description Stored optimistic-locking version.
             */
            version?: number | null;
        };
        /**
         * AdminFilterCondition
         * @description One advanced field condition (``where``).
         *
         *     Every condition must hold (AND), so the same field may carry several of
         *     them. ``field`` is validated against the closed allowlist here — the model
         *     is the single place both the query parameter and the scan body go through —
         *     and resolved into its stored Mongo path by ``resolve_filter_field``.
         */
        AdminFilterCondition: {
            /** Field */
            field: string;
            /**
             * Op
             * @enum {string}
             */
            op: "equals" | "not_equals" | "contains" | "not_contains" | "starts_with" | "greater_than" | "less_than" | "exists" | "not_exists" | "is_empty" | "is_not_empty" | "before" | "after" | "contains_any" | "contains_all";
            /** Value */
            value?: unknown;
        };
        /** CatalogFilters */
        CatalogFilters: {
            /** City */
            city?: string | null;
            /** Concepts */
            concepts?: components["schemas"]["ConceptFilter"][];
            /** Curator Id */
            curator_id?: string | null;
            /** Entity Type */
            entity_type?: string | null;
            /**
             * Exclude Curation Ids
             * @description Curation ids the scan must drop from its materialized set, ANDed with every other filter (at most 10000 ids; over the bound the route answers 413). Omitted or empty means no exclusion.
             */
            exclude_curation_ids?: string[];
            /** Q */
            q?: string | null;
            /** Sort */
            sort?: ("sequence_asc" | "sequence_desc" | "updated_at_desc" | "updated_at_asc" | "created_at_desc" | "created_at_asc" | "name_asc" | "name_desc") | null;
            /** Status */
            status?: ("draft" | "linked" | "active" | "deleted" | "archived")[];
            /**
             * Unlinked
             * @description True selects Curations with no Entity (``entity_id`` missing, null, empty or whitespace-only); false selects only Curations that have one. Omitted means both.
             */
            unlinked?: boolean | null;
            /** Updated From */
            updated_from?: string | null;
            /** Updated To */
            updated_to?: string | null;
            /**
             * Where
             * @description Advanced field conditions, ANDed with every other filter.
             */
            where?: components["schemas"]["AdminFilterCondition"][];
        };
        /**
         * CatalogRecordResponse
         * @description The complete stored document, JSON-safe and key-for-key faithful.
         *
         *     Mongo's ``_id`` is exposed as ``id``; ``ObjectId``/``Decimal128`` become
         *     strings, dates become ISO-8601 strings and binary payloads (packed float32
         *     embedding vectors included) become a ``{"format": ..., "byte_length": N}``
         *     summary. Every other key — unknown and legacy ones included — is returned
         *     untouched, EXCEPT the API's own derived keys for Entities
         *     (``catalog_records.ENTITY_INTERNAL_FIELDS``: the persisted display media of
         *     the card), which are not editorial content and are neither read nor written
         *     through this surface.
         */
        CatalogRecordResponse: {
            /** Record */
            record: Record<string, never>;
        };
        /** CatalogScanPage */
        CatalogScanPage: {
            /** Items */
            items: components["schemas"]["AdminCurationRow"][];
            /** Next Cursor */
            next_cursor?: string | null;
        };
        /** CatalogScanPageRequest */
        CatalogScanPageRequest: {
            /** Cursor */
            cursor?: string | null;
            /**
             * Limit
             * @default 100
             */
            limit: number;
            /** Scan Token */
            scan_token: string;
        };
        /** CatalogScanStart */
        CatalogScanStart: {
            /** Max Catalog Sequence */
            max_catalog_sequence: number;
            /** Scan Token */
            scan_token: string;
        };
        /** CatalogScanStartRequest */
        CatalogScanStartRequest: {
            filters?: components["schemas"]["CatalogFilters"];
        };
        /** CatalogSearchPage */
        CatalogSearchPage: {
            /** Items */
            items: components["schemas"]["AdminCurationRow"][];
            /** Next Cursor */
            next_cursor?: string | null;
            /** Total */
            total?: number | null;
        };
        /**
         * CmsAuthorization
         * @description The current operational authorization for a CMS administrator.
         */
        CmsAuthorization: {
            /** Authorized */
            authorized: boolean;
            /** Authz Revision */
            authz_revision: string;
            /**
             * Email
             * Format: email
             */
            email: string;
            /** Name */
            name: string;
            /** Picture */
            picture?: string | null;
            /**
             * Role
             * @enum {string}
             */
            role: "admin" | "curator" | "viewer";
            /** User Id */
            user_id: string;
        };
        /**
         * CmsCurationUpdate
         * @description Curation update sent by the CMS: every root key is accepted.
         *
         *     The domain model stays strict on purpose; this boundary is the one that
         *     lets the Admin edit a legacy field no screen ever declared (plan §45).
         *     System-managed keys are rejected against the raw request body before this
         *     model is built, so a rejected key never reaches a write.
         */
        CmsCurationUpdate: {
            categories?: components["schemas"]["CurationCategories"] | null;
            curator?: components["schemas"]["CuratorInfo"] | null;
            /** Curator Id */
            curator_id?: string | null;
            /** Embeddings */
            embeddings?: Record<string, never>[] | null;
            /** Embeddings Metadata */
            embeddings_metadata?: Record<string, never> | null;
            /** Entity Id */
            entity_id?: string | null;
            /** Items */
            items?: Record<string, never>[] | null;
            notes?: components["schemas"]["CurationNotes"] | null;
            /** Restaurant Name */
            restaurant_name?: string | null;
            /** Sources */
            sources?: Record<string, never> | null;
            /** Status */
            status?: ("draft" | "linked" | "active" | "deleted" | "archived") | null;
            /** Transcript */
            transcript?: string | null;
            /** Updatedby */
            updatedBy?: string | null;
        } & {
            [key: string]: unknown;
        };
        /**
         * CmsEntityUpdate
         * @description Entity update sent by the CMS: every root key is accepted.
         */
        CmsEntityUpdate: {
            /**
             * Data
             * @description Flexible data storage
             */
            data?: Record<string, never> | null;
            /** Externalid */
            externalId?: string | null;
            /** Metadata */
            metadata?: components["schemas"]["Metadata"][] | null;
            /** Name */
            name?: string | null;
            /** Status */
            status?: ("active" | "inactive" | "draft") | null;
            sync?: components["schemas"]["SyncInfo"] | null;
            /** Type */
            type?: ("restaurant" | "hotel" | "venue" | "bar" | "cafe" | "other") | null;
            /**
             * Updatedby
             * @description Curator ID who updated this
             */
            updatedBy?: string | null;
        } & {
            [key: string]: unknown;
        };
        /**
         * CmsExchangeRequest
         * @description Payload accepted by the server-to-server one-shot exchange endpoint.
         */
        CmsExchangeRequest: {
            /** Code */
            code: string;
            /** State */
            state: string;
            /** Target Origin */
            target_origin: string;
        };
        /**
         * CmsIntrospectionRequest
         * @description Payload accepted by the CMS introspection endpoint.
         */
        CmsIntrospectionRequest: {
            /** Subject */
            subject: string;
        };
        /**
         * ConceptFilter
         * @description One ``concept.<Category>=<value>`` array-contains condition.
         *
         *     The value must be contained in the stored ``categories.<Category>`` array;
         *     every supplied condition must hold (AND).
         */
        ConceptFilter: {
            /** Category */
            category: string;
            /** Value */
            value: string;
        };
        /**
         * ContentHealthRequest
         * @description Members the caller already tracks in published Collections.
         */
        ContentHealthRequest: {
            /**
             * Member Curation Ids
             * @description Curation ids currently published as Collection members (at most 10000; over the bound the route answers 413).
             */
            member_curation_ids: string[];
        };
        /**
         * ContentHealthResponse
         * @description Editorial counters for the Admin overview, over non-deleted Curations.
         *
         *     ``updated_today`` counts Curations whose ``updatedAt`` falls inside the last
         *     24 hours from the moment of the request. ``without_collections`` counts the
         *     Curations that are not in the member ids the caller reported.
         */
        ContentHealthResponse: {
            /**
             * Entities Display Media Resolved
             * @description Entities with a durable, proven display media fact.
             */
            entities_display_media_resolved?: number | null;
            /**
             * Entities No Sources
             * @description Entities with neither website nor place_id: nothing to resolve.
             */
            entities_no_sources?: number | null;
            /**
             * Entities Total
             * @description Entities in the catalog.
             */
            entities_total?: number | null;
            /**
             * Entities Unresolved
             * @description Entities whose display media is missing or failed.
             */
            entities_unresolved?: number | null;
            /**
             * Synthetic Drafts
             * @description ``curator_type == 'synthetic'`` and ``status == 'draft'``.
             */
            synthetic_drafts: number;
            /** Total */
            total: number;
            /**
             * Unlinked
             * @description No Entity attached (``entity_id`` missing, null or blank).
             */
            unlinked: number;
            /**
             * Updated Today
             * @description ``updatedAt`` inside the last 24 hours.
             */
            updated_today: number;
            /**
             * Without Collections
             * @description Not among the reported Collection member ids.
             */
            without_collections: number;
            /**
             * Without Images
             * @description No usable ``sources.image`` list (absent, non-list or empty).
             */
            without_images: number;
            /**
             * Without Transcript
             * @description ``transcript`` missing, null or empty.
             */
            without_transcript: number;
        };
        /**
         * CurationCategories
         * @description Concept categories - flexible structure loaded from MongoDB concepts collection
         *     Categories are NOT hardcoded - they come from database and can change dynamically
         */
        CurationCategories: {
            [key: string]: unknown;
        };
        /**
         * CurationNotes
         * @description Public and private notes
         */
        CurationNotes: {
            /** Private */
            private?: string | null;
            /** Public */
            public?: string | null;
        };
        /**
         * CurationSummariesRequest
         * @description A bounded batch of Curations the CMS wants to render as list rows.
         */
        CurationSummariesRequest: {
            /** Curation Ids */
            curation_ids: string[];
        };
        /**
         * CurationSummariesResponse
         * @description One ``AdminCurationRow`` per requested Curation, in the requested order.
         *
         *     Ids that do not exist are omitted — a stale Collection membership or a
         *     deleted Curation renders as nothing instead of failing the whole batch.
         */
        CurationSummariesResponse: {
            /** Items */
            items: components["schemas"]["AdminCurationRow"][];
        };
        /**
         * CuratorInfo
         * @description Curator information
         */
        CuratorInfo: {
            /** Email */
            email?: string | null;
            /** Id */
            id: string;
            /** Name */
            name: string;
        };
        /**
         * CuratorListPage
         * @description One bounded page of the curator directory, ordered by name.
         *
         *     The directory is always searched and never dumped: ``limit`` bounds the
         *     page, and there is no keyset behind it — a curator search is a short list,
         *     not a scrollable catalog — so ``next_cursor`` is always null.
         */
        CuratorListPage: {
            /** Items */
            items: components["schemas"]["CuratorRow"][];
            /** Next Cursor */
            next_cursor?: string | null;
        };
        /**
         * CuratorRow
         * @description One curator of the directory: the identity a ``curator_id`` write carries.
         */
        CuratorRow: {
            /** Curator Id */
            curator_id: string;
            /** Email */
            email?: string | null;
            /** Name */
            name?: string | null;
        };
        /**
         * EntityCurationsPage
         * @description Every stored Curation attached to one Entity, newest first.
         */
        EntityCurationsPage: {
            /** Items */
            items: Record<string, never>[];
            /** Total */
            total: number;
        };
        /**
         * EntityImageItem
         * @description One ranked Entity image and the boundary path that serves its bytes.
         */
        EntityImageItem: {
            /** Rank */
            rank: number;
            /** Source */
            source: string;
            /** Url */
            url: string;
        };
        /**
         * EntityImagesResponse
         * @description The ranked images of one Entity, ascending by rank, never past the ceiling.
         */
        EntityImagesResponse: {
            /** Items */
            items: components["schemas"]["EntityImageItem"][];
        };
        /** EntityListPage */
        EntityListPage: {
            /** Items */
            items: components["schemas"]["EntityRow"][];
            /** Next Cursor */
            next_cursor?: string | null;
            /** Total */
            total?: number | null;
        };
        /**
         * EntityRow
         * @description One row of the Admin Entity list.
         */
        EntityRow: {
            /**
             * City
             * @description City derived from the stored ``data.city`` value (null when the document has none).
             */
            city?: string | null;
            /**
             * Curation Ids
             * @description Ids of the Curations referencing this Entity (deleted tombstones excluded), so the CMS can count the Collections that hold them. A boundary-only join input: it is not part of the Admin browser contract.
             */
            curation_ids?: string[];
            /**
             * Curations Count
             * @description Curations referencing this Entity, excluding those with status == 'deleted'.
             * @default 0
             */
            curations_count: number;
            /** Entity Id */
            entity_id?: string | null;
            /** Id */
            id: string;
            /** Name */
            name?: string | null;
            /** Status */
            status?: string | null;
            /** Type */
            type?: string | null;
            /** Updated At */
            updated_at?: string | null;
            /** Version */
            version?: number | null;
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** HydrateCurationsRequest */
        HydrateCurationsRequest: {
            /** Curation Ids */
            curation_ids: string[];
        };
        /** HydrateCurationsResponse */
        HydrateCurationsResponse: {
            /** Available Count */
            available_count: number;
            /** Items */
            items: components["schemas"]["PublicCurationItem"][];
            /** Selected Count */
            selected_count: number;
            /** Unavailable */
            unavailable: components["schemas"]["UnavailableItem"][];
            /** Unavailable Count */
            unavailable_count: number;
        };
        /**
         * Metadata
         * @description Extensible metadata from multiple sources
         */
        Metadata: {
            /**
             * Data
             * @description Flexible data storage
             */
            data?: Record<string, never>;
            /**
             * Importedat
             * @description Import timestamp
             */
            importedAt?: string | null;
            /**
             * Source
             * @description Data source identifier
             */
            source: string;
            /**
             * Type
             * @description Metadata type (e.g., 'google_places', 'michelin')
             */
            type: string;
        };
        /**
         * PublicCurationItem
         * @description The only Curation/Entity fields permitted across the CMS boundary.
         */
        PublicCurationItem: {
            /** Curation Id */
            curation_id: string;
            /** Curation Note */
            curation_note?: string | null;
            /** Entity Id */
            entity_id: string;
            /** Name */
            name: string;
        };
        /** PublishedCollectionAssociation */
        PublishedCollectionAssociation: {
            /** Collection Id */
            collection_id: string;
            /** Current Published Version */
            current_published_version: number;
            /** Slug */
            slug: string;
            /** Title */
            title: string;
        };
        /** PublishedCollectionAssociationResponse */
        PublishedCollectionAssociationResponse: {
            /** Items */
            items: components["schemas"]["PublishedCollectionAssociation"][];
        };
        /** RejectedCuration */
        RejectedCuration: {
            /** Curation Id */
            curation_id: string;
            /**
             * Reason
             * @enum {string}
             */
            reason: "not_found" | "ineligible_status";
        };
        /**
         * ResolveCurationsRequest
         * @description A bounded, explicitly chosen set of Curations to resolve.
         */
        ResolveCurationsRequest: {
            /** Curation Ids */
            curation_ids: string[];
        };
        /** ResolveCurationsResponse */
        ResolveCurationsResponse: {
            /** Eligible Ids */
            eligible_ids: string[];
            /** Rejected */
            rejected: components["schemas"]["RejectedCuration"][];
        };
        /**
         * SyncInfo
         * @description Client-server synchronization metadata
         */
        SyncInfo: {
            /**
             * Lastsyncedat
             * @description Last sync timestamp
             */
            lastSyncedAt?: string | null;
            /**
             * Serverid
             * @description Server-side ID
             */
            serverId?: number | null;
            /**
             * Status
             * @description Sync status
             * @default pending
             */
            status: string;
        };
        /** UnavailableItem */
        UnavailableItem: {
            /** Curation Id */
            curation_id: string;
            /**
             * Reason
             * @enum {string}
             */
            reason: "curation_missing" | "curation_not_public" | "missing_entity" | "entity_not_public" | "schema_invalid";
        };
        /** ValidationError */
        ValidationError: {
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    authorize_api_v3_auth_cms_authorize_get: {
        parameters: {
            query: {
                state: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            307: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    exchange_api_v3_auth_cms_exchange_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CmsExchangeRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CmsAuthorization"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    introspect_api_v3_auth_cms_introspect_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CmsIntrospectionRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CmsAuthorization"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    introspect_bearer_api_v3_auth_cms_introspect_bearer_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CmsAuthorization"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    read_content_health_api_v3_catalog_content_health_post: {
        parameters: {
            query?: never;
            header: {
                "X-CMS-Actor-Id": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ContentHealthRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContentHealthResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    search_curations_api_v3_catalog_curations_get: {
        parameters: {
            query?: {
                q?: string | null;
                status?: string[];
                city?: string | null;
                entity_type?: string | null;
                curator_id?: string | null;
                /** @description true lists only Curations with no Entity (``entity_id`` missing, null, empty or whitespace-only); false lists only the ones that have one. */
                unlinked?: boolean | null;
                /** @description Repeated advanced condition, each value a URL-encoded JSON object `{"field": "<path>", "op": "<op>", "value": <json>}`; every condition must hold. */
                where?: string[];
                sort?: "sequence_asc" | "sequence_desc" | "updated_at_desc" | "updated_at_asc" | "created_at_desc" | "created_at_asc" | "name_asc" | "name_desc";
                cursor?: string | null;
                limit?: number;
                /** @description Repeated array-contains condition on the stored `categories.<Category>` array; every supplied condition must hold. The category may not contain `$`, `.` or a null byte. */
                "concept.<Category>"?: string;
            };
            header: {
                "X-CMS-Actor-Id": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CatalogSearchPage"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    resolve_curation_selection_api_v3_catalog_curations_resolve_post: {
        parameters: {
            query?: never;
            header: {
                "X-CMS-Actor-Id": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResolveCurationsRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResolveCurationsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    scan_page_api_v3_catalog_curations_scan_page_post: {
        parameters: {
            query?: never;
            header: {
                "X-CMS-Actor-Id": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CatalogScanPageRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CatalogScanPage"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    start_scan_api_v3_catalog_curations_scan_start_post: {
        parameters: {
            query?: never;
            header: {
                "X-CMS-Actor-Id": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CatalogScanStartRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CatalogScanStart"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    read_curation_summaries_api_v3_catalog_curations_summaries_post: {
        parameters: {
            query?: never;
            header: {
                "X-CMS-Actor-Id": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CurationSummariesRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CurationSummariesResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_curation_record_api_v3_catalog_curations__curation_id__patch: {
        parameters: {
            query?: never;
            header: {
                "If-Match"?: string | null;
                "X-CMS-Actor-Id": string;
                "X-CMS-Actor-Role"?: string | null;
            };
            path: {
                curation_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CmsCurationUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CatalogRecordResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    read_curation_record_api_v3_catalog_curations__curation_id__record_get: {
        parameters: {
            query?: never;
            header: {
                "X-CMS-Actor-Id": string;
            };
            path: {
                curation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CatalogRecordResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_catalog_curators_api_v3_catalog_curators_get: {
        parameters: {
            query?: {
                q?: string | null;
                limit?: number;
            };
            header: {
                "X-CMS-Actor-Id": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CuratorListPage"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_stored_entities_api_v3_catalog_entities_get: {
        parameters: {
            query?: {
                q?: string | null;
                type?: string | null;
                status?: string | null;
                limit?: number;
                after_id?: string | null;
            };
            header: {
                "X-CMS-Actor-Id": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EntityListPage"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_entity_record_api_v3_catalog_entities__entity_id__patch: {
        parameters: {
            query?: never;
            header: {
                "If-Match"?: string | null;
                "X-CMS-Actor-Id": string;
                "X-CMS-Actor-Role"?: string | null;
            };
            path: {
                entity_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CmsEntityUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CatalogRecordResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_entity_curations_api_v3_catalog_entities__entity_id__curations_get: {
        parameters: {
            query?: {
                limit?: number;
                after_id?: string | null;
            };
            header: {
                "X-CMS-Actor-Id": string;
            };
            path: {
                entity_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EntityCurationsPage"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    read_entity_image_api_v3_catalog_entities__entity_id__image_get: {
        parameters: {
            query?: {
                /** @description Rank da imagem coletada; 0 é o hero que a listagem usa como thumbnail. */
                rank?: number;
            };
            header: {
                "X-CMS-Actor-Id": string;
            };
            path: {
                entity_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    read_entity_images_api_v3_catalog_entities__entity_id__images_get: {
        parameters: {
            query?: never;
            header: {
                "X-CMS-Actor-Id": string;
            };
            path: {
                entity_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EntityImagesResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    read_entity_record_api_v3_catalog_entities__entity_id__record_get: {
        parameters: {
            query?: never;
            header: {
                "X-CMS-Actor-Id": string;
            };
            path: {
                entity_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CatalogRecordResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    published_associations_api_v3_curations__curation_id__collections_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                curation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublishedCollectionAssociationResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    hydrate_curations_api_v3_internal_curations_hydrate_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HydrateCurationsRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HydrateCurationsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
}

