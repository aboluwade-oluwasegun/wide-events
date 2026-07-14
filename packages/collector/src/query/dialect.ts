import { sanitizeIdentifier } from "@wide-events/internal";

export interface QuerySqlDialect {
  quoteIdentifier(identifier: string): string;
  percentileSelect(percentile: number, field: string, alias: string): string;
}

export const duckDbQuerySqlDialect: QuerySqlDialect = {
  quoteIdentifier(identifier) {
    return `"${sanitizeIdentifier(identifier)}"`;
  },

  percentileSelect(percentile, field, alias) {
    return `PERCENTILE_CONT(${percentile}) WITHIN GROUP (ORDER BY ${this.quoteIdentifier(
      sanitizeIdentifier(field),
    )})${alias}`;
  },
};

export const clickHouseQuerySqlDialect: QuerySqlDialect = {
  quoteIdentifier(identifier) {
    return `\`${sanitizeIdentifier(identifier)}\``;
  },

  percentileSelect(percentile, field, alias) {
    return `quantile(${percentile})(${this.quoteIdentifier(
      sanitizeIdentifier(field),
    )})${alias}`;
  },
};

export function quoteSanitizedIdentifier(identifier: string): string {
  return duckDbQuerySqlDialect.quoteIdentifier(identifier);
}
