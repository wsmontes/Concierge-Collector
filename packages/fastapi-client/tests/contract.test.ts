import { describe, expect, it, vi } from "vitest";

import { FastApiAdminClient } from "../src/index";

describe("FastApiAdminClient", () => {
  it("sends the service credential and a typed exchange payload", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          user_id: "curator-1",
          email: "admin@example.com",
          name: "Admin",
          picture: null,
          role: "admin",
          authorized: true,
          authz_revision: "revision-1",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new FastApiAdminClient({
      baseUrl: "https://api.concierge-collector.com/",
      serviceKey: "service-key",
      fetch,
    });

    const authorization = await client.exchange({
      code: "opaque-code",
      state: "state",
      target_origin: "https://admin.concierge-collector.com",
    });

    expect(authorization).toMatchObject({ user_id: "curator-1", role: "admin", authorized: true });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.concierge-collector.com/api/v3/auth/cms/exchange",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-cms-service-key": "service-key",
        },
        body: JSON.stringify({
          code: "opaque-code",
          state: "state",
          target_origin: "https://admin.concierge-collector.com",
        }),
      }),
    );
  });

  it("resolves bounded selections with the authoritative CMS actor", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ eligible_ids: ["c1"], rejected: [] }), { status: 200 }),
    );
    const client = new FastApiAdminClient({ baseUrl: "https://api.example.test", serviceKey: "service-key", fetch });

    await expect(client.resolveCurations({ curation_ids: ["c1"] }, "admin-1"))
      .resolves.toEqual({ eligible_ids: ["c1"], rejected: [] });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.test/api/v3/catalog/curations/resolve",
      expect.objectContaining({ headers: expect.objectContaining({ "x-cms-actor-id": "admin-1" }) }),
    );
  });
});
