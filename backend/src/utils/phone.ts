/**
 * Normalize an Indian mobile number to E.164 (+91XXXXXXXXXX) when unambiguous.
 * Leaves anything else (already-prefixed or foreign formats) trimmed as-is, so
 * lookups can try both the raw and normalized forms.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return raw.trim();
}
