import { describe, expect, it } from "vitest";
import { assertReadOnlySql, compileStructuredQuery } from "./build-query";

describe("compileStructuredQuery", () => {
  it("defaults structured queries to main=true scope", () => {
    const compiled = compileStructuredQuery({
      select: [{ fn: "COUNT", as: "total" }]
    });

    expect(compiled.sql).toContain('WHERE "main" = ?');
    expect(compiled.params).toEqual([true]);
  });

  it("omits the main filter for all-event queries", () => {
    const compiled = compileStructuredQuery({
      select: [{ fn: "COUNT", as: "total" }],
      scope: "all"
    });

    expect(compiled.sql).not.toContain('"main" = ?');
    expect(compiled.params).toEqual([]);
  });

  it("compiles aggregates, filters, grouping, ordering, and limit", () => {
    const compiled = compileStructuredQuery({
      select: [
        { fn: "COUNT", as: "total" },
        { fn: "P99", field: "duration_ms", as: "p99_ms" }
      ],
      filters: [
        { field: "main", op: "eq", value: true },
        { field: "service.name", op: "eq", value: "payments" }
      ],
      groupBy: ["http.route"],
      orderBy: { field: "p99_ms", dir: "desc" },
      limit: 10,
      scope: "all"
    });

    expect(compiled.sql).toContain('COUNT(*) AS "total"');
    expect(compiled.sql).toContain(
      'PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY "duration_ms") AS "p99_ms"'
    );
    expect(compiled.sql).toContain('SELECT "http.route", COUNT(*) AS "total"');
    expect(compiled.sql).toContain('GROUP BY "http.route"');
    expect(compiled.sql).toContain('ORDER BY "p99_ms" DESC');
    expect(compiled.params).toEqual([true, "payments"]);
  });

  it("rejects explicit main filters when scope defaults to main", () => {
    expect(() =>
      compileStructuredQuery({
        select: [{ fn: "COUNT", as: "total" }],
        filters: [{ field: "main", op: "eq", value: true }]
      })
    ).toThrow(/scope "main"/);
  });

  it("preserves quoting for sanitized aliases, group by, order by, and filters", () => {
    const compiled = compileStructuredQuery({
      select: [{ fn: "MAX", field: "duration_ms", as: "duration.max" }],
      filters: [{ field: "service.name", op: "eq", value: "api" }],
      groupBy: ["http.route"],
      orderBy: { field: "duration.max", dir: "asc" },
      scope: "all"
    });

    expect(compiled.sql).toContain('MAX("duration_ms") AS "duration.max"');
    expect(compiled.sql).toContain('SELECT "http.route", MAX("duration_ms") AS "duration.max"');
    expect(compiled.sql).toContain('WHERE "service.name" = ?');
    expect(compiled.sql).toContain('GROUP BY "http.route"');
    expect(compiled.sql).toContain('ORDER BY "duration.max" ASC');
    expect(compiled.params).toEqual(["api"]);
  });
});

describe("assertReadOnlySql", () => {
  it("rejects mutating sql even when wrapped in whitespace", () => {
    expect(() => assertReadOnlySql("  INSERT INTO events VALUES (1)")).toThrow(
      /read-only/
    );
  });

  it("allows select statements", () => {
    expect(() => assertReadOnlySql("SELECT * FROM events")).not.toThrow();
  });
});
