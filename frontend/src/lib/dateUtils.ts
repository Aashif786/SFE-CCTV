/**
 * Robust date parsing and formatting utility.
 * Handles ISO strings with or without timezone offset/Z suffix,
 * ensuring consistent local timezone formatting across all pages.
 */

export function parseDate(iso: string | Date | number | null | undefined): Date | null {
  if (!iso) return null;
  if (iso instanceof Date) return isNaN(iso.getTime()) ? null : iso;
  if (typeof iso === "number") {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  let str = String(iso).trim();
  if (!str) return null;

  // If format is "YYYY-MM-DD HH:mm:ss", convert to ISO format
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(str)) {
    str = str.replace(/\s+/, "T");
  }

  // If format is ISO without timezone offset or Z (e.g. "2026-08-04T11:50:00"),
  // append 'Z' so JavaScript treats it as UTC instead of local time
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(str)) {
    str += "Z";
  }

  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

export function formatTime(iso: string | Date | number | null | undefined): string {
  const d = parseDate(iso);
  return d ? d.toLocaleTimeString() : "—";
}

export function formatDate(iso: string | Date | number | null | undefined): string {
  const d = parseDate(iso);
  return d ? d.toLocaleDateString() : "—";
}

export function formatDateTime(iso: string | Date | number | null | undefined): string {
  const d = parseDate(iso);
  return d ? `${d.toLocaleDateString()} · ${d.toLocaleTimeString()}` : "—";
}

export function formatElapsed(iso: string | Date | number | null | undefined): string {
  const d = parseDate(iso);
  if (!d) return "—";
  const secs = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m ago`;
}
