"use client";

export function safeJsonStringify(value: any): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export function computeContextSignature(stepDataSoFar: Record<string, any>) {
  const keys = Object.keys(stepDataSoFar || {})
    .filter((k) => typeof k === "string" && !k.startsWith("__"))
    .sort();
  const snapshot: Record<string, any> = {};
  for (const k of keys) snapshot[k] = stepDataSoFar[k];
  return safeJsonStringify(snapshot);
}
