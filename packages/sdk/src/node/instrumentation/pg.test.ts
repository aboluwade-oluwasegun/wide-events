import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { InstrumentationHooks } from "../../shared/instrumentation/types.js";
import { instrumentPg } from "./pg.js";

function createFakePool(impl: (...args: unknown[]) => unknown) {
  return {
    query: vi.fn(impl),
  } as unknown as Pool;
}

describe("instrumentPg", () => {
  it("records db.queries on success", async () => {
    const pushSpy = vi.fn();
    const recordErrorSpy = vi.fn();
    const hooks: InstrumentationHooks = {
      push: pushSpy,
      recordError: recordErrorSpy,
    };

    const pool = createFakePool(async () => ({ rowCount: 3 }));
    instrumentPg(pool, hooks);

    await pool.query("SELECT 1 WHERE id = $1", ["a"]);

    expect(pushSpy).toHaveBeenCalledWith(
      "db.queries",
      expect.objectContaining({
        sql: expect.any(String),
        row_count: 3,
      }),
    );
    expect(recordErrorSpy).not.toHaveBeenCalled();
  });

  it("truncates sql", async () => {
    const pushSpy = vi.fn();
    const recordErrorSpy = vi.fn();
    const hooks: InstrumentationHooks = {
      push: pushSpy,
      recordError: recordErrorSpy,
    };

    const longSql = `SELECT '${"x".repeat(300)}'`;
    const pool = createFakePool(async () => ({ rowCount: 0 }));

    instrumentPg(pool, hooks, { sqlTruncateLength: 50 });

    await pool.query(longSql);

    expect(pushSpy).toHaveBeenCalledWith(
      "db.queries",
      expect.objectContaining({
        sql: expect.stringMatching(/^SELECT /u),
      }),
    );
    const [, payload] = pushSpy.mock.calls[0] ?? [];
    expect(String((payload as { sql: unknown }).sql).length).toBeLessThanOrEqual(52);
  });

  it("records db.errors and recordError then rethrows", async () => {
    const pushSpy = vi.fn();
    const recordErrorSpy = vi.fn();
    const hooks: InstrumentationHooks = {
      push: pushSpy,
      recordError: recordErrorSpy,
    };

    const pool = createFakePool(async () => {
      throw new Error("timeout");
    });
    instrumentPg(pool, hooks);

    await expect(pool.query("SELECT bad")).rejects.toThrow("timeout");

    expect(pushSpy).toHaveBeenCalledWith(
      "db.errors",
      expect.objectContaining({
        error: "timeout",
      }),
    );
    expect(recordErrorSpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ slug: "pg_query_failed" }),
    );
  });

  it("does not wrap twice when called twice", async () => {
    const pushSpy = vi.fn();
    const recordErrorSpy = vi.fn();
    const hooks: InstrumentationHooks = {
      push: pushSpy,
      recordError: recordErrorSpy,
    };

    let calls = 0;
    const pool = createFakePool(async () => {
      calls += 1;
      return { rowCount: 1 };
    });

    instrumentPg(pool, hooks);
    instrumentPg(pool, hooks);

    await pool.query("SELECT 1");
    expect(calls).toBe(1);
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });
});
