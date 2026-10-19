import type { Organization } from "@/auth/use-current-doctor";
import raw from "./us-health-organizations.json";

/**
 * Curated directory of real U.S. healthcare organizations (major systems, AMCs, children's
 * hospitals, large medical groups). It has two jobs:
 *
 *  1. Instant, offline search results for the "Find your organization" step.
 *  2. Fallback when the server-side directory (GET /api/doctor/organizations, backed by the
 *     CMS/NPPES import) isn't deployed or reachable — useOrganizationSearch merges both.
 *
 * The full long-tail directory (every clinic/practice) lives server-side; this file stays small
 * so the bundle does not carry the whole country.
 */
export interface DirectoryOrganization extends Organization {
  allowedDomains: string[];
  city?: string;
  state?: string;
}

interface RawOrg {
  id: string;
  name: string;
  domains?: string[];
  city?: string;
  state?: string;
}

export const ORGANIZATIONS: DirectoryOrganization[] = (raw as RawOrg[]).map((o) => ({
  id: o.id,
  name: o.name,
  slug: o.id,
  allowedDomains: o.domains ?? [],
  city: o.city,
  state: o.state,
}));

/**
 * Normalize an organization name for dedupe: lowercase, fold punctuation, drop corporate
 * suffixes (Inc/LLC/…) and articles, collapse whitespace. "WakeMed Health & Hospitals, Inc."
 * and "WAKEMED HEALTH AND HOSPITALS" normalize identically.
 */
export function normalizeOrgName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(incorporated|inc|llc|llp|pllc|plc|pc|pa|corp|corporation|company|co|ltd|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findOrganization(id: string): DirectoryOrganization | undefined {
  return ORGANIZATIONS.find((o) => o.id === id);
}

/**
 * Ranked substring search over the curated directory: name prefix > word prefix > name
 * substring > domain > city > exact state code. Mirrors how the server-side search ranks.
 */
export function searchOrganizations(query: string, limit = 12): DirectoryOrganization[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const scored: { o: DirectoryOrganization; s: number }[] = [];
  for (const o of ORGANIZATIONS) {
    const name = o.name.toLowerCase();
    let s: number | null = null;
    if (name.startsWith(q)) s = 0;
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) s = 1;
    else if (name.includes(q)) s = 2;
    else if (o.allowedDomains.some((d) => d.includes(q))) s = 3;
    else if (o.city?.toLowerCase().startsWith(q)) s = 4;
    else if (q.length === 2 && o.state?.toLowerCase() === q) s = 5;
    if (s != null) scored.push({ o, s });
  }
  scored.sort((a, b) => a.s - b.s || a.o.name.localeCompare(b.o.name));
  return scored.slice(0, limit).map((x) => x.o);
}
