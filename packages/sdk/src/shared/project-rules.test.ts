import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProjectRulesManager,
  parseProjectRulesDocument,
  type ProjectRulesDocument,
} from "./project-rules";

describe("parseProjectRulesDocument", () => {
  it("parses valid CDN project rules", () => {
    const parsed = parseProjectRulesDocument({
      version: 1,
      rules: [
        {
          project_id: "project_checkout",
          project_rule_version: "rules-v1",
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
            {
              field: "checkout.status_code",
              source: "response.status",
              type: "BIGINT",
            },
          ],
        },
      ],
    });

    expect(parsed).toEqual({
      version: 1,
      rules: [
        {
          project_id: "project_checkout",
          project_rule_version: "rules-v1",
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
            {
              field: "checkout.status_code",
              source: "response.status",
              type: "BIGINT",
              optional: false,
            },
          ],
        },
      ],
    });
  });

  it("rejects invalid CDN project rules", () => {
    expect(() =>
      parseProjectRulesDocument({
        version: 1,
        rules: [
          {
            project_id: "project_checkout",
            project_rule_version: "rules-v1",
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
      }),
    ).toThrow(/reserved|dot path/u);
  });
});

describe("ProjectRulesManager", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches and caches rules until the refresh interval expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T00:00:00.000Z"));

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(createRulesDocument("rules-v1")))
      .mockResolvedValueOnce(jsonResponse(createRulesDocument("rules-v2")));
    const manager = new ProjectRulesManager({
      projectRules: {
        url: "https://cdn.example.com/wide-events/project-rules.json",
        refreshIntervalMs: 1_000,
      },
      fetchImpl,
    });

    await expect(manager.getRules()).resolves.toEqual([
      expect.objectContaining({ project_rule_version: "rules-v1" }),
    ]);
    await expect(manager.getRules()).resolves.toEqual([
      expect.objectContaining({ project_rule_version: "rules-v1" }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(999);
    await expect(manager.getRules()).resolves.toEqual([
      expect.objectContaining({ project_rule_version: "rules-v1" }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await expect(manager.getRules()).resolves.toEqual([
      expect.objectContaining({ project_rule_version: "rules-v2" }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("disables extraction when no valid rules exist", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        version: 1,
        rules: [
          {
            project_id: "project_checkout",
            project_rule_version: "rules-v1",
            match: {
              method: "POST",
              path: "/checkout",
            },
            fields: [
              {
                field: "order.total",
                source: "request.body",
                type: "DOUBLE",
              },
            ],
          },
        ],
      }),
    );
    const manager = new ProjectRulesManager({
      projectRules: {
        url: "https://cdn.example.com/wide-events/project-rules.json",
        refreshIntervalMs: 1_000,
      },
      fetchImpl,
    });

    await expect(manager.getRules()).resolves.toEqual([]);
    expect(manager.currentDocument()).toBeNull();
    expect(manager.lastError).toBeInstanceOf(Error);
  });

  it("keeps the last valid rules when refresh fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T00:00:00.000Z"));

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(createRulesDocument("rules-v1")))
      .mockRejectedValueOnce(new Error("offline"));
    const manager = new ProjectRulesManager({
      projectRules: {
        url: "https://cdn.example.com/wide-events/project-rules.json",
        refreshIntervalMs: 1_000,
      },
      fetchImpl,
    });

    await expect(manager.getRules()).resolves.toEqual([
      expect.objectContaining({ project_rule_version: "rules-v1" }),
    ]);

    vi.advanceTimersByTime(1_000);

    await expect(manager.getRules()).resolves.toEqual([
      expect.objectContaining({ project_rule_version: "rules-v1" }),
    ]);
    expect(manager.lastError?.message).toBe("offline");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not fetch when project rules are not configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const manager = new ProjectRulesManager({ fetchImpl });

    await expect(manager.getRules()).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function createRulesDocument(ruleVersion: string): ProjectRulesDocument {
  return {
    version: 1,
    rules: [
      {
        project_id: "project_checkout",
        project_rule_version: ruleVersion,
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
    ],
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
