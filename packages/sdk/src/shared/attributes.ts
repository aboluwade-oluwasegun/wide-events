import {
  isBaselineColumn,
  isPrimitiveEventValue,
  PROMOTION_HINT_PREFIX,
  type DynamicEventAttributes,
  type EventPrimitive
} from "@wide-events/internal";

export type AnnotationAttributes = Record<string, EventPrimitive | undefined>;
export type AnnotationKey<T extends AnnotationAttributes> = Extract<keyof T, string>;
export interface AnnotateOptions<T extends AnnotationAttributes> {
  promote?: readonly AnnotationKey<T>[];
}

export function normalizeAttributes(
  attributes: AnnotationAttributes
): DynamicEventAttributes {
  const normalized: DynamicEventAttributes = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (!isPrimitiveEventValue(value) && typeof value !== "undefined") {
      throw new Error(`annotate() attribute "${key}" must be a primitive value`);
    }

    normalized[key] = typeof value === "undefined" ? null : value;
  }

  return normalized;
}

export function buildAnnotatedAttributes<T extends AnnotationAttributes>(
  attributes: T,
  options?: AnnotateOptions<T>
): DynamicEventAttributes {
  const normalized = normalizeAttributes(attributes);
  for (const key of options?.promote ?? []) {
    if (!(key in normalized)) {
      throw new Error(`annotate() promote key "${key}" is missing from attributes`);
    }

    if (isBaselineColumn(key)) {
      throw new Error(`annotate() cannot promote baseline column "${key}"`);
    }

    normalized[`${PROMOTION_HINT_PREFIX}${key}`] = true;
  }

  return normalized;
}
