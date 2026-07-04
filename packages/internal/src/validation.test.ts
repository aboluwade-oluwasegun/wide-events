import { describe, expect, it } from "vitest";
import {
  projectRoutingConfigResponseSchema,
  projectRoutingQuerySchema,
  structuredQuerySchema,
  wideEventSchema,
} from "./validation";

describe("wideEventSchema project metadata", () => {
  it("accepts valid project metadata", () => {
    const parsed = wideEventSchema.parse({
      event_id: "event-1",
      correlation_id: "corr-1",
      project_id: "project_123",
      project_rule_version: "2026-07-01",
      project_fields: {
        "order.total": 49.99,
        "order.confirmed": true,
        "customer.tier": "gold"
      },
      project_field_types: {
        "order.total": "DOUBLE",
        "order.confirmed": "BOOLEAN",
        "customer.tier": "VARCHAR"
      }
    });

    expect(parsed.project_id).toBe("project_123");
    expect(parsed.project_fields?.["order.total"]).toBe(49.99);
    expect(parsed.project_field_types?.["order.total"]).toBe("DOUBLE");
  });

  it("rejects an empty project_id", () => {
    expect(
      wideEventSchema.safeParse({
        event_id: "event-1",
        project_id: ""
      }).success
    ).toBe(false);
  });

  it("rejects unsupported project field types", () => {
    expect(
      wideEventSchema.safeParse({
        event_id: "event-1",
        project_id: "project_123",
        project_fields: {
          "order.created_at": "2026-07-01T00:00:00.000Z"
        },
        project_field_types: {
          "order.created_at": "TIMESTAMPTZ"
        }
      }).success
    ).toBe(false);
  });

  it("rejects project field names that collide with baseline or project metadata fields", () => {
    expect(
      wideEventSchema.safeParse({
        event_id: "event-1",
        project_id: "project_123",
        project_fields: {
          "service.name": "checkout"
        },
        project_field_types: {
          "service.name": "VARCHAR"
        }
      }).success
    ).toBe(false);

    expect(
      wideEventSchema.safeParse({
        event_id: "event-1",
        project_id: "project_123",
        project_fields: {
          project_id: "project_456"
        },
        project_field_types: {
          project_id: "VARCHAR"
        }
      }).success
    ).toBe(false);
  });
});

describe("project routing config validation", () => {
  it("accepts routing config responses", () => {
    const parsed = projectRoutingConfigResponseSchema.parse({
      ttl_seconds: 60,
      projects: [
        {
          project_id: "project_checkout",
          project_rule_version: "2026-07-01",
          service_name: "checkout",
          environment: "prod"
        },
        {
          project_id: "project_global",
          project_rule_version: "global-v1",
          service_name: null,
          environment: null
        }
      ]
    });

    expect(parsed.projects).toHaveLength(2);
  });

  it("accepts both project routing query naming styles", () => {
    expect(
      projectRoutingQuerySchema.parse({
        serviceName: "checkout",
        serviceEnvironment: "prod"
      })
    ).toEqual({
      serviceName: "checkout",
      serviceEnvironment: "prod"
    });

    expect(
      projectRoutingQuerySchema.parse({
        "service.name": "checkout",
        "service.environment": "prod"
      })
    ).toEqual({
      "service.name": "checkout",
      "service.environment": "prod"
    });
  });
});

describe("structuredQuerySchema", () => {
  it("accepts project_events source", () => {
    const parsed = structuredQuerySchema.parse({
      source: "project_events",
      select: [{ fn: "COUNT", as: "total" }],
      filters: [{ field: "project_id", op: "eq", value: "project_123" }]
    });

    expect(parsed.source).toBe("project_events");
  });
});
