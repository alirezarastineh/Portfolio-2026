import type { AppTranslations, Availability } from "./schema";

/** The status dot's colour: green while open, orange while limited, faint while closed. */
export const AVAILABILITY_DOT: Record<Availability, string> = {
  open: "bg-available",
  limited: "bg-signal",
  closed: "bg-faint-foreground",
};

/** The CMS's words for an availability: `Open to senior AI / full-stack roles`. */
export function availabilityLabel(t: AppTranslations["hero"], availability: Availability): string {
  const labels: Record<Availability, string> = {
    open: t.availabilityOpen,
    limited: t.availabilityLimited,
    closed: t.availabilityClosed,
  };
  return labels[availability];
}
