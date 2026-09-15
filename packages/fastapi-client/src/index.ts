import type { components, paths } from "./generated.js";

export type { components, paths } from "./generated.js";

export type CmsAuthorization = components["schemas"]["CmsAuthorization"];
export type CmsExchangeRequest = components["schemas"]["CmsExchangeRequest"];
export type CmsIntrospectionRequest = components["schemas"]["CmsIntrospectionRequest"];
export type ResolveCurationsRequest = components["schemas"]["ResolveCurationsRequest"];
export type ResolveCurationsResponse = components["schemas"]["ResolveCurationsResponse"];
export type CatalogSearchPage = components["schemas"]["CatalogSearchPage"];
export type CatalogSearchQuery = NonNullable<paths["/api/v3/catalog/curations"]["get"]["parameters"]["query"]>;
export type CatalogFilters = components["schemas"]["CatalogFilters"];
export type AdminFilterCondition = components["schemas"]["AdminFilterCondition"];
export type AdminCurationRow = components["schemas"]["AdminCurationRow"];
export type CurationSummariesRequest = components["schemas"]["CurationSummariesRequest"];
export type CurationSummariesResponse = components["schemas"]["CurationSummariesResponse"];
export type ContentHealthRequest = components["schemas"]["ContentHealthRequest"];
export type ContentHealthResponse = components["schemas"]["ContentHealthResponse"];
export type CatalogScanPageRequest = components["schemas"]["CatalogScanPageRequest"];
export type CatalogRecordResponse = components["schemas"]["CatalogRecordResponse"];
export type EntityListPage = components["schemas"]["EntityListPage"];
export type EntityRow = components["schemas"]["EntityRow"];
export type EntityCurationsPage = components["schemas"]["EntityCurationsPage"];
export type EntityListQuery = NonNullable<paths["/api/v3/catalog/entities"]["get"]["parameters"]["query"]>;
export type EntityCurationsQuery = NonNullable<
  paths["/api/v3/catalog/entities/{entity_id}/curations"]["get"]["parameters"]["query"]
>;

/**
 * Partial record update: `updates` holds the roots the caller wants written and
 * `expectedVersion` is the version the editor opened, sent as `If-Match`.
 */
export interface RecordUpdatePayload {
  updates: Record<string, unknown>;
  expectedVersion: number;
}

/** One `concept.<Category>=<value>` facet of the catalog search. */
export interface ConceptFacet {
  category: string;
  value: string;
}

type ExchangeResponse = paths["/api/v3/auth/cms/exchange"]["post"] extends {
  responses: { 200: { content: { "application/json": infer Response } } };
}
  ? Response
  : never;

type IntrospectionResponse = paths["/api/v3/auth/cms/introspect"]["post"] extends {
  responses: { 200: { content: { "application/json": infer Response } } };
}
  ? Response
  : never;

type ResolveCurationsResponseContract = paths["/api/v3/catalog/curations/resolve"]["post"] extends {
  responses: { 200: { content: { "application/json": infer Response } } };
}
  ? Response
  : never;

type CatalogSearchResponse = paths["/api/v3/catalog/curations"]["get"] extends {
  responses: { 200: { content: { "application/json": infer Response } } };
}
  ? Response
  : never;

type CatalogScanStartResponse = paths["/api/v3/catalog/curations/scan/start"]["post"] extends {
  responses: { 200: { content: { "application/json": infer Response } } };
}
  ? Response
  : never;

type CatalogScanPageResponse = paths["/api/v3/catalog/curations/scan/page"]["post"] extends {
  responses: { 200: { content: { "application/json": infer Response } } };
}
  ? Response
  : never;

export interface FastApiAdminClientOptions {
  baseUrl: string;
  serviceKey: string;
  fetch?: typeof globalThis.fetch;
}

export class FastApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(`FastAPI Admin request failed with status ${status}`);
    this.name = "FastApiClientError";
  }
}

/** Typed server-to-server client for the intentionally narrow Admin contract. */
export class FastApiAdminClient {
  private readonly baseUrl: string;
  private readonly serviceKey: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor({ baseUrl, serviceKey, fetch = globalThis.fetch }: FastApiAdminClientOptions) {
    if (!fetch) {
      throw new Error("FastApiAdminClient requires a fetch implementation");
    }
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.serviceKey = serviceKey;
    this.fetch = fetch;
  }

  exchange(payload: CmsExchangeRequest): Promise<ExchangeResponse> {
    return this.post("/api/v3/auth/cms/exchange", payload);
  }

  introspect(payload: CmsIntrospectionRequest): Promise<IntrospectionResponse> {
    return this.post("/api/v3/auth/cms/introspect", payload);
  }

  resolveCurations(payload: ResolveCurationsRequest, actorId: string): Promise<ResolveCurationsResponseContract> {
    return this.post("/api/v3/catalog/curations/resolve", payload, { "x-cms-actor-id": actorId });
  }

  /**
   * Admin list rows for many Curations at once, in the requested order.
   * Ids that do not exist are omitted, never an error.
   */
  curationSummaries(curationIds: string[], actorId: string): Promise<CurationSummariesResponse> {
    const payload: CurationSummariesRequest = { curation_ids: curationIds };
    return this.post("/api/v3/catalog/curations/summaries", payload, { "x-cms-actor-id": actorId });
  }

  /** Editorial counters over the non-deleted catalog. */
  contentHealth(payload: ContentHealthRequest, actorId: string): Promise<ContentHealthResponse> {
    return this.post("/api/v3/catalog/content-health", payload, { "x-cms-actor-id": actorId });
  }

  searchCurations(
    query: CatalogSearchQuery,
    actorId: string,
    concepts: readonly ConceptFacet[] = [],
  ): Promise<CatalogSearchResponse> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
      else params.set(key, String(value));
    }
    // Concept facets are dynamic keys (`concept.<Category>`), so they cannot be
    // part of the closed query object the contract declares.
    for (const concept of concepts) {
      params.append(`concept.${concept.category}`, concept.value);
    }
    const suffix = params.size ? `?${params.toString()}` : "";
    return this.get(`/api/v3/catalog/curations${suffix}`, { "x-cms-actor-id": actorId });
  }

  startCatalogScan(filters: CatalogFilters, actorId: string): Promise<CatalogScanStartResponse> {
    return this.post("/api/v3/catalog/curations/scan/start", { filters }, { "x-cms-actor-id": actorId });
  }

  scanCatalogPage(payload: CatalogScanPageRequest, actorId: string): Promise<CatalogScanPageResponse> {
    return this.post("/api/v3/catalog/curations/scan/page", payload, { "x-cms-actor-id": actorId });
  }

  /** Complete stored Curation document, for the editorial record surfaces. */
  curationRecord(curationId: string, actorId: string): Promise<CatalogRecordResponse> {
    return this.get(`/api/v3/catalog/curations/${encodeURIComponent(curationId)}/record`, {
      "x-cms-actor-id": actorId,
    });
  }

  /** Complete stored Entity document. */
  entityRecord(entityId: string, actorId: string): Promise<CatalogRecordResponse> {
    return this.get(`/api/v3/catalog/entities/${encodeURIComponent(entityId)}/record`, {
      "x-cms-actor-id": actorId,
    });
  }

  /** Cursor page of stored Entities ordered by `_id`. */
  searchEntities(query: EntityListQuery, actorId: string): Promise<EntityListPage> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      if (Array.isArray(value)) value.forEach((item) => params.append(key, String(item)));
      else params.set(key, String(value));
    }
    const suffix = params.size ? `?${params.toString()}` : "";
    return this.get(`/api/v3/catalog/entities${suffix}`, { "x-cms-actor-id": actorId });
  }

  /** Every stored Curation attached to one Entity, newest first. */
  entityCurations(
    entityId: string,
    query: EntityCurationsQuery,
    actorId: string,
  ): Promise<EntityCurationsPage> {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    if (query.after_id) params.set("after_id", query.after_id);
    const suffix = params.size ? `?${params.toString()}` : "";
    return this.get(`/api/v3/catalog/entities/${encodeURIComponent(entityId)}/curations${suffix}`, {
      "x-cms-actor-id": actorId,
    });
  }

  /**
   * Partial update of a stored Curation. `expectedVersion` becomes `If-Match`,
   * so the domain's optimistic lock is the only way a write advances a record.
   */
  updateCurationRecord(
    curationId: string,
    payload: RecordUpdatePayload,
    actorId: string,
    actorRole: string,
  ): Promise<CatalogRecordResponse> {
    return this.patch(`/api/v3/catalog/curations/${encodeURIComponent(curationId)}`, payload, actorId, actorRole);
  }

  /** Partial update of a stored Entity, same lock contract. */
  updateEntityRecord(
    entityId: string,
    payload: RecordUpdatePayload,
    actorId: string,
    actorRole: string,
  ): Promise<CatalogRecordResponse> {
    return this.patch(`/api/v3/catalog/entities/${encodeURIComponent(entityId)}`, payload, actorId, actorRole);
  }

  private async patch<Response>(
    path: string,
    payload: RecordUpdatePayload,
    actorId: string,
    actorRole: string,
  ): Promise<Response> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-cms-service-key": this.serviceKey,
        "x-cms-actor-id": actorId,
        "x-cms-actor-role": actorRole,
        "if-match": String(payload.expectedVersion),
      },
      body: JSON.stringify(payload.updates),
    });
    if (!response.ok) throw new FastApiClientError(response.status, await response.text());
    return (await response.json()) as unknown as Response;
  }

  private async post<Request, Response>(path: string, payload: Request, extraHeaders: Record<string, string> = {}): Promise<Response> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cms-service-key": this.serviceKey,
        ...extraHeaders,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new FastApiClientError(response.status, await response.text());
    }

    return (await response.json()) as unknown as Response;
  }

  private async get<Response>(path: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      headers: {
        "x-cms-service-key": this.serviceKey,
        ...extraHeaders,
      },
    });
    if (!response.ok) throw new FastApiClientError(response.status, await response.text());
    return (await response.json()) as unknown as Response;
  }
}
