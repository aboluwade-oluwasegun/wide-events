import { describe, expect, it } from "vitest";
import type { ProjectEventRow } from "@wide-events/internal";
import type { CollectorConfig } from "../config";
import { ProjectRegistry } from "./registry";

describe("ProjectRegistry", () => {
  it("rejects duplicate project IDs", () => {
    const projects: CollectorConfig["projects"] = [
      createProject("project_123"),
      createProject("project_123"),
    ];

    expect(() => new ProjectRegistry(projects, 60)).toThrow(
      /Duplicate projectId "project_123"/,
    );
  });

  it("fills a missing project_rule_version from the active project config", () => {
    const registry = new ProjectRegistry(
      [
        createProject("project_123", {
          serviceName: "checkout",
          environment: "prod",
          ruleVersion: "2026-07-01",
        }),
      ],
      60,
    );

    expect(registry.prepareProjectRows([createProjectRow()])).toEqual([
      {
        ...createProjectRow(),
        project_rule_version: "2026-07-01",
      },
    ]);
  });
});

function createProject(
  projectId: string,
  overrides: Partial<CollectorConfig["projects"][number]> = {},
): CollectorConfig["projects"][number] {
  return {
    projectId,
    serviceName: null,
    environment: null,
    active: true,
    ruleVersion: "1",
    ...overrides,
  };
}

function createProjectRow(): ProjectEventRow {
  return {
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
    "http.route": null,
    "http.status_code": null,
    "http.request.method": null,
    error: null,
    "exception.slug": null,
    "user.id": null,
    "user.type": null,
    "user.org.id": null,
    project_id: "project_123",
    project_rule_version: null,
    project_fields: {
      "order.total": 42,
    },
    project_field_types: {
      "order.total": "DOUBLE",
    },
  };
}
