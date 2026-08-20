export interface CmsIdentity {
  authz_revision: string
  authorized: boolean
  email: string
  name: string
  picture: string | null
  role: 'admin' | 'curator' | 'viewer'
  user_id: string
}

export class FastApiAuthzError extends Error {
  constructor(readonly status: number) {
    super(`FastAPI authz failed: ${status}`)
    this.name = 'FastApiAuthzError'
  }
}

export class FastApiAuthzClient {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceKey: string,
  ) {}

  async exchangeCmsCode(input: {
    code: string
    state: string
    targetOrigin: string
  }): Promise<CmsIdentity> {
    return this.post<CmsIdentity>('/api/v3/auth/cms/exchange', {
      code: input.code,
      state: input.state,
      target_origin: input.targetOrigin,
    })
  }

  async introspectSubject(subject: string): Promise<CmsIdentity> {
    return this.post<CmsIdentity>('/api/v3/auth/cms/introspect', { subject })
  }

  async introspectCollectorBearer(authorization: string, requestId: string): Promise<CmsIdentity> {
    return this.post<CmsIdentity>('/api/v3/auth/cms/introspect-bearer', undefined, {
      Authorization: authorization,
      'X-Request-Id': requestId,
    })
  }

  private async post<T>(path: string, body: unknown, headers: HeadersInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'X-CMS-Service-Key': this.serviceKey,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new FastApiAuthzError(response.status)
    return response.json() as Promise<T>
  }
}
