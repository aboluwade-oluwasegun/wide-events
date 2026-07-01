import type { InferredAttributeType } from "@wide-events/internal";
import { clickHouseQuoteIdentifier } from "./schema.js";

export function bindClickHouseReadParams(
  sql: string,
  values: readonly unknown[],
): { query: string; query_params?: Record<string, unknown> } {
  if (values.length === 0) {
    return { query: sql };
  }

  const queryParams: Record<string, unknown> = {};
  let index = 0;
  const query = sql.replace(/\?/gu, () => {
    const name = `p${index}`;
    const value = values[index];
    queryParams[name] = value;
    index += 1;
    return `{${name}:${inferClickHouseParamType(value)}}`;
  });

  if (index !== values.length) {
    throw new Error(
      `ClickHouse parameter mismatch: SQL used ${index}, received ${values.length}`,
    );
  }

  return { query, query_params: queryParams };
}

export function buildClickHouseBackfillExpression(
  type: InferredAttributeType,
): string {
  const mapValue = `${clickHouseQuoteIdentifier(
    "attributes_overflow",
  )}[{rawKey:String}]`;

  switch (type) {
    case "BOOLEAN":
      return `toBoolOrNull(${mapValue})`;
    case "BIGINT":
      return `toInt64OrNull(${mapValue})`;
    case "DOUBLE":
      return `toFloat64OrNull(${mapValue})`;
    case "VARCHAR":
    case "JSON":
      return mapValue;
    default:
      return assertNever(type);
  }
}

function inferClickHouseParamType(value: unknown): string {
  if (typeof value === "boolean") {
    return "Bool";
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? "Int64" : "Float64";
  }

  if (value === null || typeof value === "undefined") {
    return "Nullable(String)";
  }

  return "String";
}

function assertNever(value: never): never {
  throw new Error(`Unsupported ClickHouse backfill type: ${String(value)}`);
}
