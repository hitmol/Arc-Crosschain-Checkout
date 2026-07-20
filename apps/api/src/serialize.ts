export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export function jsonSafe(value: readonly unknown[]): JsonValue[];
export function jsonSafe(value: object): { [key: string]: JsonValue };
export function jsonSafe(value: unknown): JsonValue;
export function jsonSafe(value: unknown): JsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  ) as JsonValue;
}
