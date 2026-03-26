"use client";

export function isValidEmail(value: string): boolean {
  const s = value.trim();
  if (!s || s.length < 5) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function isValidFullName(value: string): boolean {
  return value.trim().length >= 2;
}

export function formatPhoneInput(value: string): { display: string; digits: string } {
  const digits = String(value || "")
    .replace(/\D/g, "")
    .slice(0, 10);
  if (digits.length <= 3) return { display: digits ? `(${digits}` : "", digits };
  if (digits.length <= 6) return { display: `(${digits.slice(0, 3)}) ${digits.slice(3)}`, digits };
  return { display: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`, digits };
}
