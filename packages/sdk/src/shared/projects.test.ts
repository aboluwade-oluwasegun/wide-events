import type { WideEvent } from "@wide-events/internal";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectRoutingManager } from "./projects";

describe("ProjectRoutingManager", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("infers project field types", () => {
    const manager = new ProjectRoutingManager({
      projects: ["project_a"],
      serviceName: "checkout",
      environment: "prod",
      fetchImpl: fetch,
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

  it("expands project events across explicit project ids", async () => {
    const manager = new ProjectRoutingManager({
      projects: ["project_a", "project_b"],
      serviceName: "checkout",
      environment: "prod",
      fetchImpl: fetch,
    });

    await expect(manager.prepareEvents([createProjectEvent()])).resolves.toEqual([
      expect.objectContaining({ project_id: "project_a" }),
      expect.objectContaining({ project_id: "project_b" }),
    ]);
  });

  it("honors collector TTL for empty project config responses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T00:00:00.000Z"));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ttl_seconds: 60,
          projects: [],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const manager = new ProjectRoutingManager({
      projects: true,
      collectorUrl: "http://collector.test",
      serviceName: "checkout",
      environment: "prod",
      fetchImpl,
    });

    await expect(manager.prepareEvents([createProjectEvent()])).rejects.toThrow(
      "No active projects are configured for this SDK instance",
    );
    await expect(manager.prepareEvents([createProjectEvent()])).rejects.toThrow(
      "No active projects are configured for this SDK instance",
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

function createProjectEvent(): WideEvent {
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
  };
}
