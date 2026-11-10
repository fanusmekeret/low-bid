/** Public alias for a bidder, e.g. "Abebe Kebede" + id 4 -> "A***e 4". Never exposes names or phones. */
export function bidderAlias(fullName: string, userId: bigint | number): string {
  const name = fullName.trim();
  if (name.length === 0) return `Bidder ${userId}`;
  const first = name[0];
  const last = name.length > 1 ? name[name.length - 1] : "";
  return `${first}***${last} ${userId}`;
}
