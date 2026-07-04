import { describe, expect, it } from "vitest";
import {
  extractProjectMetadata,
  findMatchingProjectRule,
} from "./project-extraction";
import type { ProjectExtractionRule } from "./project-rules";

describe("findMatchingProjectRule", () => {
  it("selects the rule matching method and path", () => {
    const rules = [
      createRule({
        projectId: "project_read",
        method: "GET",
        path: "/checkout",
      }),
      createRule({
        projectId: "project_write",
        method: "POST",
        path: "/checkout",
      }),
    ];

    expect(
      findMatchingProjectRule(rules, {
        method: "post",
        path: "/checkout?coupon=SUMMER",
      }),
    ).toEqual(expect.objectContaining({ project_id: "project_write" }));
  });
});

describe("extractProjectMetadata", () => {
  it("returns no metadata for non-matching requests", () => {
    const metadata = extractProjectMetadata(
      [createRule({ projectId: "project_checkout" })],
      {
        request: {
          method: "GET",
          path: "/checkout",
        },
      },
    );

    expect(metadata).toBeNull();
  });

  it("extracts request and response fields from supported sources", () => {
    const metadata = extractProjectMetadata(
      [
        {
          project_id: "project_checkout",
          project_rule_version: "rules-v2",
          match: {
            method: "POST",
            path: "/checkout",
          },
          fields: [
            {
              field: "cart.item_count",
              source: "request.body",
              path: "cart.itemCount",
              type: "BIGINT",
              optional: false,
            },
            {
              field: "coupon.code",
              source: "request.query",
              path: "coupon",
              type: "VARCHAR",
              optional: false,
            },
            {
              field: "order.id",
              source: "request.params",
              path: "orderId",
              type: "VARCHAR",
              optional: false,
            },
            {
              field: "request.id",
              source: "request.headers",
              path: "x-request-id",
              type: "VARCHAR",
              optional: false,
            },
            {
              field: "order.total",
              source: "response.body",
              path: "total",
              type: "DOUBLE",
              optional: false,
            },
            {
              field: "response.status",
              source: "response.status",
              type: "BIGINT",
              optional: false,
            },
          ],
        },
      ],
      {
        request: {
          method: "POST",
          path: "/checkout",
          body: {
            cart: {
              itemCount: 3,
            },
          },
          query: new URLSearchParams({ coupon: "SUMMER" }),
          params: {
            orderId: "ord_123",
          },
          headers: {
            "X-Request-Id": "req_456",
          },
        },
        response: {
          body: {
            total: 42.5,
          },
          status: 201,
        },
      },
    );

    expect(metadata).toEqual({
      project_id: "project_checkout",
      project_rule_version: "rules-v2",
      project_fields: {
        "cart.item_count": 3,
        "coupon.code": "SUMMER",
        "order.id": "ord_123",
        "order.total": 42.5,
        "request.id": "req_456",
        "response.status": 201,
      },
      project_field_types: {
        "cart.item_count": "BIGINT",
        "coupon.code": "VARCHAR",
        "order.id": "VARCHAR",
        "order.total": "DOUBLE",
        "request.id": "VARCHAR",
        "response.status": "BIGINT",
      },
    });
  });

  it("skips missing optional paths and emits null for missing required paths", () => {
    const metadata = extractProjectMetadata(
      [
        {
          project_id: "project_checkout",
          project_rule_version: "rules-v3",
          match: {
            method: "POST",
            path: "/checkout",
          },
          fields: [
            {
              field: "required.missing",
              source: "request.body",
              path: "checkout.required",
              type: "VARCHAR",
              optional: false,
            },
            {
              field: "optional.missing",
              source: "request.body",
              path: "checkout.optional",
              type: "VARCHAR",
              optional: true,
            },
          ],
        },
      ],
      {
        request: {
          method: "POST",
          path: "/checkout",
          body: {
            checkout: {},
          },
        },
      },
    );

    expect(metadata).toEqual({
      project_id: "project_checkout",
      project_rule_version: "rules-v3",
      project_fields: {
        "required.missing": null,
      },
      project_field_types: {
        "required.missing": "VARCHAR",
      },
    });
  });

  it("uses rule-declared project field types", () => {
    const metadata = extractProjectMetadata(
      [
        {
          project_id: "project_checkout",
          project_rule_version: "rules-v4",
          match: {
            method: "POST",
            path: "/checkout",
          },
          fields: [
            {
              field: "order.total",
              source: "request.body",
              path: "total",
              type: "JSON",
              optional: false,
            },
          ],
        },
      ],
      {
        request: {
          method: "POST",
          path: "/checkout",
          body: {
            total: 42.5,
          },
        },
      },
    );

    expect(metadata?.project_fields).toEqual({ "order.total": 42.5 });
    expect(metadata?.project_field_types).toEqual({ "order.total": "JSON" });
  });
});

function createRule(options: {
  projectId: string;
  method?: string | undefined;
  path?: string | undefined;
}): ProjectExtractionRule {
  return {
    project_id: options.projectId,
    project_rule_version: "rules-v1",
    match: {
      method: options.method ?? "POST",
      path: options.path ?? "/checkout",
    },
    fields: [
      {
        field: "checkout.converted",
        source: "response.status",
        type: "BIGINT",
        optional: false,
      },
    ],
  };
}
