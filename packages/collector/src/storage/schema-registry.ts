import {
  BASELINE_COLUMN_NAMES,
  BASELINE_COLUMN_TYPES,
  type InferredAttributeType,
} from "@wide-events/internal";
import type { CollectorDatabase } from "./types.js";

export class SchemaRegistry {
  private readonly columns = new Map<string, string>();

  constructor(private readonly maxPromotedColumns: number) {
    for (const [name, type] of Object.entries(BASELINE_COLUMN_TYPES)) {
      this.columns.set(name, type);
    }
  }

  async hydrate(database: CollectorDatabase): Promise<void> {
    for (const row of await database.readColumns("events")) {
      const name = expectString(row.name, "table column name");
      const type = expectString(row.type, "table column type");
      this.columns.set(name, type);
    }
  }

  listActualColumns(): Array<{ name: string; type: string }> {
    return [...this.columns.entries()]
      .map(([name, type]) => ({ name, type }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  isKnownColumn(name: string): boolean {
    return this.columns.has(name);
  }

  isQueryableColumn(name: string): boolean {
    return this.columns.has(name) && name !== "attributes_overflow";
  }

  promotedColumnCount(): number {
    return [...this.columns.keys()].filter(
      (name) => !BASELINE_COLUMN_NAMES.includes(name)
    ).length;
  }

  async ensurePromotedColumn(
    database: CollectorDatabase,
    column: string,
    type: InferredAttributeType
  ): Promise<boolean> {
    if (this.columns.has(column)) {
      return true;
    }

    if (this.promotedColumnCount() >= this.maxPromotedColumns) {
      return false;
    }

    await database.addPromotedColumn("events", column, type);
    this.columns.set(column, type);
    return true;
  }
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }

  return value;
}
