import { quoteIdentifier } from "@wide-events/internal";
import { ATTRIBUTE_CATALOG_COLUMNS } from "../attribute-catalog-row.js";

export function readDuckDbTableColumnsSql(table: string): string {
  return `PRAGMA table_info(${quoteStringLiteral(table)})`;
}

export function buildDuckDbInsertSql(
  table: string,
  columns: readonly string[],
  rowCount: number,
): string {
  const placeholders = Array.from({ length: rowCount }, () => {
    const rowPlaceholders = columns.map((column) => {
      if (column === "attributes_overflow" || column === "project_fields") {
        return "CAST(CAST(? AS JSON) AS MAP(VARCHAR, JSON))";
      }

      if (column === "project_field_types") {
        return "CAST(CAST(? AS JSON) AS MAP(VARCHAR, VARCHAR))";
      }

      return "?";
    });
    return `(${rowPlaceholders.join(", ")})`;
  }).join(", ");

  return `INSERT INTO ${quoteIdentifier(table)} (${columns
    .map((column) => quoteIdentifier(column))
    .join(", ")}) VALUES ${placeholders}`;
}

export function buildDuckDbAttributeCatalogSaveSql(): string {
  return `INSERT INTO attribute_catalog (
      ${ATTRIBUTE_CATALOG_COLUMNS.map(quoteIdentifier).join(",\n      ")}
    ) VALUES (${ATTRIBUTE_CATALOG_COLUMNS.map(() => "?").join(", ")})
    ON CONFLICT(key) DO UPDATE SET
      sanitized_key = excluded.sanitized_key,
      storage_state = excluded.storage_state,
      inferred_type = excluded.inferred_type,
      seen_rows = excluded.seen_rows,
      non_null_rows = excluded.non_null_rows,
      first_seen_at = excluded.first_seen_at,
      last_seen_at = excluded.last_seen_at,
      promoted_column = excluded.promoted_column,
      promoted_type = excluded.promoted_type,
      promoted_at = excluded.promoted_at,
      last_error = excluded.last_error`;
}

export function buildDuckDbPromotionBackfillSql(
  column: string,
  type: string,
): string {
  const expression =
    type === "VARCHAR"
      ? "json_extract_string(map_extract_value(attributes_overflow, ?), '$')"
      : type === "JSON"
        ? "map_extract_value(attributes_overflow, ?)"
        : `TRY_CAST(map_extract_value(attributes_overflow, ?) AS ${type})`;

  return `UPDATE events
      SET ${quoteIdentifier(column)} = ${expression}
      WHERE ${quoteIdentifier(column)} IS NULL
        AND map_extract_value(attributes_overflow, ?) IS NOT NULL`;
}

function quoteStringLiteral(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}
