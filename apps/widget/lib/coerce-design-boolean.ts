/**
 * Normalize design toggles that may arrive as strings or numbers from APIs or storage.
 * (e.g. `"false"` is truthy in JS and would wrongly enable logo/header if unchecked with `&&`.)
 */
export function coerceDesignBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  if (value == null || value === "") return defaultValue;
  return defaultValue;
}
