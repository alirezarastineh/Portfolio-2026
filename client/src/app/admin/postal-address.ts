/**
 * Whether a text names a postcode and a town ("10115 Berlin"): the part of § 5 DDG's postal address a check can
 * see. Legal's note asks for an address while neither language's imprint has one.
 * shortcut: five digits and a capitalised word; an address written another way reads as none, so the note says
 * "No postal address found", never that there is none. Upgrade if a real imprint trips it.
 */
export function hasPostalAddress(html: string): boolean {
  return /\b\d{5}\s+\p{Lu}/u.test(html.replace(/&nbsp;|<[^<>]+>/g, " "));
}
