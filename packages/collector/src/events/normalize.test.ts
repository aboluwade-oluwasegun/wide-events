import { describe, expect, it } from "vitest";
import type { WideEvent, WideEventBatch } from "@wide-events/internal";
import {
  normalizeEvent,
  normalizeEventBatch,
  normalizeEventBatchForIngest,
} from "./normalize";

describe("event normalization", () => {
  it("keeps default event normalization unchanged when project_id is absent", () => {
    const event: WideEvent = {
      event_id: "event-1",
      correlation_id: "corr-1",
      parent_event_id: null,
      ts: "2024-01-01T00:00:00.000Z",
      duration_ms: 12.5,
      main: true,
      sample_rate: 2,
      "service.name": "checkout",
      "service.environment": "test",
      "http.route": "/checkout",
      "http.status_code": 200,
      "http.request.method": "POST",
      error: false,
      attributes: {
        "user.id": "user-1",
        "order.total": 42,
        "order.tags": ["new", "vip"],
      },
      promote: ["order.total"],
    };

    expect(normalizeEvent(event)).toEqual({
      event_id: "event-1",
      correlation_id: "corr-1",
      parent_event_id: null,
      ts: "2024-01-01T00:00:00.000Z",
      duration_ms: 12.5,
      main: true,
      sample_rate: 2,
      "service.name": "checkout",
      "service.environment": "test",
      "service.version": null,
      "http.route": "/checkout",
      "http.status_code": 200,
      "http.request.method": "POST",
      error: false,
      "exception.slug": null,
      "user.id": "user-1",
      "user.type": null,
      "user.org.id": null,
      attributes_overflow: {
        "order.total": 42,
        "order.tags": ["new", "vip"],
      },
      promoted_attribute_hints: ["order.total"],
    });

    expect(normalizeEventBatch({ events: [event] })).toEqual([
      normalizeEvent(event),
    ]);
  });

  it("normalizes project events into project rows only", () => {
    const batch: WideEventBatch = {
      events: [
        {
          event_id: "event-project",
          correlation_id: "corr-project",
          ts: "2024-01-01T00:00:00.000Z",
          main: true,
          "service.name": "checkout",
          "service.environment": "prod",
          "http.route": "/checkout",
          "http.status_code": 201,
          "http.request.method": "POST",
          "user.id": "user-1",
          project_id: "project_123",
          project_rule_version: "2026-07-01",
          project_fields: {
            "order.total": 42.5,
            "order.confirmed": true,
            "customer.tier": "gold",
            "payload.raw": { sku: "sku_123" },
          },
          project_field_types: {
            "order.total": "DOUBLE",
            "order.confirmed": "BOOLEAN",
            "customer.tier": "VARCHAR",
            "payload.raw": "JSON",
          },
        },
      ],
    };

    const normalized = normalizeEventBatchForIngest(batch);

    expect(normalized.defaultRows).toEqual([]);
    expect(normalized.projectRows).toEqual([
      {
        event_id: "event-project",
        correlation_id: "corr-project",
        parent_event_id: null,
        ts: "2024-01-01T00:00:00.000Z",
        duration_ms: null,
        main: true,
        sample_rate: 1,
        "service.name": "checkout",
        "service.environment": "prod",
        "service.version": null,
        "http.route": "/checkout",
        "http.status_code": 201,
        "http.request.method": "POST",
        error: null,
        "exception.slug": null,
        "user.id": "user-1",
        "user.type": null,
        "user.org.id": null,
        project_id: "project_123",
        project_rule_version: "2026-07-01",
        project_fields: {
          "order.total": 42.5,
          "order.confirmed": true,
          "customer.tier": "gold",
          "payload.raw": { sku: "sku_123" },
        },
        project_field_types: {
          "order.total": "DOUBLE",
          "order.confirmed": "BOOLEAN",
          "customer.tier": "VARCHAR",
          "payload.raw": "JSON",
        },
      },
    ]);
  });

  it("splits mixed batches into default and project row groups", () => {
    const normalized = normalizeEventBatchForIngest({
      events: [
        {
          event_id: "event-default",
          correlation_id: "corr-default",
          ts: "2024-01-01T00:00:00.000Z",
          "service.name": "checkout",
          attributes: {
            "order.total": 12,
          },
        },
        {
          event_id: "event-project",
          correlation_id: "corr-project",
          ts: "2024-01-01T00:00:01.000Z",
          "service.name": "checkout",
          project_id: "project_123",
          project_fields: {
            "order.total": 99,
          },
          project_field_types: {
            "order.total": "BIGINT",
          },
        },
      ],
    });

    expect(normalized.defaultRows).toHaveLength(1);
    expect(normalized.defaultRows[0]?.event_id).toBe("event-default");
    expect(normalized.defaultRows[0]?.attributes_overflow).toEqual({
      "order.total": 12,
    });
    expect(normalized.projectRows).toHaveLength(1);
    expect(normalized.projectRows[0]?.event_id).toBe("event-project");
    expect(normalized.projectRows[0]?.project_id).toBe("project_123");
  });

  it("rejects malformed project metadata clearly", () => {
    expect(() => {
      normalizeEventBatchForIngest({
        events: [
          {
            event_id: "event-project",
            project_fields: {
              "order.total": 42,
            },
            project_field_types: {
              "order.total": "DOUBLE",
            },
          },
        ],
      });
    }).toThrow(/requires project_id/);

    expect(() => {
      normalizeEventBatchForIngest({
        events: [
          {
            event_id: "event-project",
            project_id: "project_123",
            project_fields: {
              "order.total": 42,
            },
          },
        ],
      });
    }).toThrow(/requires project_field_types/);

    expect(() => {
      normalizeEventBatchForIngest({
        events: [
          {
            event_id: "event-project",
            project_id: "project_123",
            project_fields: {
              "order.total": "42",
            },
            project_field_types: {
              "order.total": "DOUBLE",
            },
          },
        ],
      });
    }).toThrow(/does not match declared type DOUBLE/);
  });
});
