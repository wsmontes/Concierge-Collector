import type { components, paths } from "./generated.js";

export type { components, paths } from "./generated.js";

export type CmsAuthorization = components["schemas"]["CmsAuthorization"];
export type CmsExchangeRequest = components["schemas"]["CmsExchangeRequest"];
export type CmsIntrospectionRequest = components["schemas"]["CmsIntrospectionRequest"];
export type ResolveCurationsRequest = components["schemas"]["ResolveCurationsRequest"];
export type ResolveCurationsResponse = components["schemas"]["ResolveCurationsResponse"];
export type CatalogSearchPage = components["schemas"]["CatalogSearchPage"];
export type CatalogSearchQuery = NonNullable<paths["/api/v3/catalog/curations"]["get"]["parameters"]["query"]>;

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

  searchCurations(query: CatalogSearchQuery, actorId: string): Promise<CatalogSearchResponse> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
      else params.set(key, String(value));
    }
    const suffix = params.size ? `?${params.toString()}` : "";
    return this.get(`/api/v3/catalog/curations${suffix}`, { "x-cms-actor-id": actorId });
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
