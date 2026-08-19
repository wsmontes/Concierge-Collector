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
}

