import { useState } from "react";
import { Building2, ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useOrganizationSearch } from "@/data/doctor-data";
import type { MockOrganization } from "@/data/mock";

/**
 * Search-only organization picker. Results appear as you type — instantly from the curated
 * U.S. health-system directory, augmented by the server-side CMS/NPPES directory when deployed.
 */
export function OrgList({ onSelect }: { onSelect: (org: MockOrganization) => void }) {
  const [q, setQ] = useState("");
  const query = q.trim();
  const results = useOrganizationSearch(q);

  return (
    <>
      <div className="relative mb-4">
        <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your hospital or clinic…"
          className="pl-9"
          autoFocus
        />
      </div>

      {query.length < 2 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          Start typing your facility's name to search.
        </p>
      ) : results.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No matches for &ldquo;{query}&rdquo;. Try the full facility name, or continue with it as typed.
        </p>
      ) : (
        <div className="space-y-2">
          {results.map((o) => {
            const place = [o.city, o.state].filter(Boolean).join(", ");
            return (
              <button
                key={o.id}
                onClick={() => onSelect(o)}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:border-primary/40 hover:bg-secondary/40 transition-colors text-left"
              >
                <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">{o.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {o.allowedDomains[0] ? `@${o.allowedDomains[0]}` : ""}
                    {o.allowedDomains[0] && place ? " · " : ""}
                    {place}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      )}

      {/* The directory isn't exhaustive, and the invite (not this list) is what grants access —
          so an unlisted facility can be entered as typed. */}
      {query.length >= 2 && (
        <button
          type="button"
          onClick={() => {
            const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            onSelect({ id: `custom:${slug}`, name: query, slug, allowedDomains: [] });
          }}
          className="mt-3 w-full text-sm text-primary hover:underline text-center"
        >
          My organization isn&rsquo;t listed: continue with &ldquo;{query}&rdquo;
        </button>
      )}
    </>
  );
}
