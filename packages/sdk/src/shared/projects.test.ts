import type { WideEvent } from "@wide-events/internal";
import { describe, expect, it, vi } from "vitest";
import { ProjectRoutingManager } from "./projects";

describe("ProjectRoutingManager", () => {
  it("infers project field types", () => {
    const manager = new ProjectRoutingManager({
      projects: {
        ids: ["project_a"],
        refreshIntervalMs: 60_000,
      },
    });

    expect(
      manager.prepareProjectAnnotation({
        "checkout.converted": true,
        "cart.item_count": 2,
        "order.total": 42.5,
        "user.segment": "enterprise",
        "cart.items": [{ sku: "sku_1" }],
      }),
    ).toEqual({
      project_id: undefined,
      project_rule_version: undefined,
      project_fields: {
        "cart.item_count": 2,
        "cart.items": [{ sku: "sku_1" }],
        "checkout.converted": true,
        "order.total": 42.5,
        "user.segment": "enterprise",
      },
      project_field_types: {
        "cart.item_count": "BIGINT",
        "cart.items": "JSON",
        "checkout.converted": "BOOLEAN",
        "order.total": "DOUBLE",
        "user.segment": "VARCHAR",
      },
    });
  });

  it("routes project events to discovered projects", async () => {
    const manager = new ProjectRoutingManager({
      projects: {
        ids: ["project_a"],
        refreshIntervalMs: 60_000,
      },
      resolveProjects: async () => [
        {
          project_id: "project_a",
          rule_version: "rules-v1",
        },
      ],
    });

    await expect(
      manager.prepareEvents([createProjectEvent({ project_id: "project_a" })]),
    ).resolves.toEqual([
      expect.objectContaining({
        project_id: "project_a",
        project_rule_version: "rules-v1",
      }),
    ]);
  });

  it("expands project events across discovered projects", async () => {
    const manager = new ProjectRoutingManager({
      projects: {
        ids: ["project_a", "project_b"],
        refreshIntervalMs: 60_000,
      },
      resolveProjects: async () => [
        {
          project_id: "project_a",
          rule_version: "rules-v1",
        },
        {
          project_id: "project_b",
          rule_version: "rules-v2",
        },
      ],
    });

    await expect(manager.prepareEvents([createProjectEvent()])).resolves.toEqual([
      expect.objectContaining({
        project_id: "project_a",
        project_rule_version: "rules-v1",
      }),
      expect.objectContaining({
        project_id: "project_b",
        project_rule_version: "rules-v2",
      }),
    ]);
  });

  it("rejects project events outside discovered projects", async () => {
    const manager = new ProjectRoutingManager({
      projects: {
        ids: ["project_a"],
        refreshIntervalMs: 60_000,
      },
      resolveProjects: async () => [
        {
          project_id: "project_a",
          rule_version: "rules-v1",
        },
      ],
    });

    await expect(
      manager.prepareEvents([createProjectEvent({ project_id: "project_b" })]),
    ).rejects.toThrow('Project "project_b" is not configured for this SDK instance');
  });

  it("has no active project routes when discovery is inactive", async () => {
    const manager = new ProjectRoutingManager({
      projects: {
        refreshIntervalMs: 60_000,
      },
      resolveProjects: async () => [],
    });

    await expect(manager.prepareEvents([createProjectEvent()])).rejects.toThrow(
      "No active projects are configured for this SDK instance",
    );
  });

  it("does not resolve projects for ordinary events", async () => {
    const resolveProjects = vi.fn<() => Promise<[]>>().mockResolvedValue([]);
    const manager = new ProjectRoutingManager({
      projects: {
        refreshIntervalMs: 60_000,
      },
      resolveProjects,
    });
    const event: WideEvent = {
      event_id: "event_1",
      correlation_id: "corr_1",
      ts: "2026-07-03T00:00:00.000Z",
      "service.name": "checkout",
      "service.environment": "prod",
    };

    await expect(manager.prepareEvents([event])).resolves.toEqual([event]);
    expect(resolveProjects).not.toHaveBeenCalled();
  });
});

function createProjectEvent(overrides: Partial<WideEvent> = {}): WideEvent {
  return {
    event_id: "event_1",
    correlation_id: "corr_1",
    ts: "2026-07-03T00:00:00.000Z",
    "service.name": "checkout",
    "service.environment": "prod",
    project_fields: {
      "checkout.converted": true,
    },
    project_field_types: {
      "checkout.converted": "BOOLEAN",
    },
    ...overrides,
  };
}
