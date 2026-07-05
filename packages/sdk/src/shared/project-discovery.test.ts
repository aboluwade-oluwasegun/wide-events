import { describe, expect, it, vi } from "vitest";
import {
  discoverProjectConfig,
  parseProjectDiscoveryResponse,
} from "./project-discovery";

describe("discoverProjectConfig", () => {
  it("posts only projectIds when explicit project ids are configured", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(createDiscoveryResponse()));

    const result = await discoverProjectConfig({
      apiKey: "we_key_123",
      apiUrl: "https://api.example.com/",
      projectIds: ["project_checkout", "another_project"],
      fetchImpl,
    });

    expect(result.active).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.com/v1/sdk/projects/discover",
      expect.objectContaining({
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer we_key_123",
          "content-type": "application/json",
        },
      }),
    );

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      projectIds: ["project_checkout", "another_project"],
    });
    expect(body).not.toHaveProperty("serviceName");
    expect(body).not.toHaveProperty("environment");
    expect(body).not.toHaveProperty("collectorUrl");
    expect(body).not.toHaveProperty("refreshIntervalMs");
  });

  it("posts an empty object when no project ids are configured", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(createDiscoveryResponse()));

    await discoverProjectConfig({
      apiKey: "we_key_123",
      apiUrl: "https://api.example.com",
      fetchImpl,
    });

    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({});
  });

  it("posts an empty object when project ids are empty", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(createDiscoveryResponse()));

    await discoverProjectConfig({
      apiKey: "we_key_123",
      apiUrl: "https://api.example.com",
      projectIds: [],
      fetchImpl,
    });

    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({});
  });

  it("does not call the API when activation config is missing", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      discoverProjectConfig({
        apiUrl: "https://api.example.com",
        projectIds: ["project_checkout"],
        fetchImpl,
      }),
    ).resolves.toEqual({
      active: false,
      reason: "missing_config",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns inactive project discovery for unauthorized responses", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("invalid token", { status: 401 }))
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }));

    await expect(
      discoverProjectConfig({
        apiKey: "we_key_123",
        apiUrl: "https://api.example.com",
        fetchImpl,
      }),
    ).resolves.toEqual({
      active: false,
      reason: "unauthorized",
      error: expect.any(Error),
    });

    await expect(
      discoverProjectConfig({
        apiKey: "we_key_123",
        apiUrl: "https://api.example.com",
        fetchImpl,
      }),
    ).resolves.toEqual({
      active: false,
      reason: "unauthorized",
      error: expect.any(Error),
    });
  });

  it("throws for non-auth discovery failures", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("server failed", { status: 500 }));

    await expect(
      discoverProjectConfig({
        apiKey: "we_key_123",
        apiUrl: "https://api.example.com",
        fetchImpl,
      }),
    ).rejects.toThrow("Project discovery failed (500): server failed");
  });
});

describe("parseProjectDiscoveryResponse", () => {
  it("normalizes project-local rules into extraction rules", () => {
    const parsed = parseProjectDiscoveryResponse(createDiscoveryResponse());

    expect(parsed).toEqual({
      active: true,
      rulesUrl: "https://cdn.example.com/wide-events/rules.json",
      projects: [
        {
          project_id: "project_checkout",
          rule_version: "2026-07-01",
        },
        {
          project_id: "another_project",
          rule_version: "2026-07-02",
        },
      ],
      rules: [
        {
          project_id: "project_checkout",
          project_rule_version: "2026-07-01",
          match: {
            method: "POST",
            path: "/checkout",
          },
          fields: [
            {
              field: "order.total",
              source: "response.body",
              path: "total",
              type: "DOUBLE",
              optional: false,
            },
          ],
        },
        {
          project_id: "another_project",
          project_rule_version: "2026-07-02",
          match: {
            method: "GET",
            path: "/subscriptions/:id",
          },
          fields: [
            {
              field: "subscription.plan",
              source: "response.body",
              path: "plan",
              type: "VARCHAR",
              optional: false,
            },
          ],
        },
      ],
    });
  });

  it("rejects malformed project-local rules", () => {
    expect(() =>
      parseProjectDiscoveryResponse({
        rulesUrl: "https://cdn.example.com/wide-events/rules.json",
        projects: [
          {
            project_id: "project_checkout",
            rule_version: "2026-07-01",
            rules: {
              routes: [
                {
                  match: {
                    method: "POST",
                    path: "/checkout",
                  },
                  fields: [
                    {
                      field: "project_id",
                      source: "request.body",
                      type: "DOUBLE",
                    },
                  ],
                },
              ],
            },
          },
        ],
      }),
    ).toThrow(/reserved|dot path/u);
  });

  it("rejects malformed discovery metadata", () => {
    expect(() =>
      parseProjectDiscoveryResponse({
        rulesUrl: "not-a-url",
        projects: [
          {
            project_id: "",
            rule_version: "",
            rules: {
              routes: [],
            },
          },
        ],
      }),
    ).toThrow();
  });
});

function createDiscoveryResponse(): unknown {
  return {
    rulesUrl: "https://cdn.example.com/wide-events/rules.json",
    projects: [
      {
        project_id: "project_checkout",
        rule_version: "2026-07-01",
        rules: {
          routes: [
            {
              match: {
                method: "post",
                path: "/checkout",
              },
              fields: [
                {
                  field: "order.total",
                  source: "response.body",
                  path: "total",
                  type: "DOUBLE",
                },
              ],
            },
          ],
        },
      },
      {
        project_id: "another_project",
        rule_version: "2026-07-02",
        rules: {
          routes: [
            {
              match: {
                method: "GET",
                path: "/subscriptions/:id",
              },
              fields: [
                {
                  field: "subscription.plan",
                  source: "response.body",
                  path: "plan",
                  type: "VARCHAR",
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
