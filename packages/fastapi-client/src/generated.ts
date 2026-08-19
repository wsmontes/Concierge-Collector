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

