/** All "N days" thresholds count business days (Mon–Fri), per drift-rules-spec.md §0. MVP hardcodes Mon–Fri, no holiday calendar. */

/** Whole business days elapsed strictly after `from`, up to and including `to`'s calendar day. */
export function businessDaysSince(from: Date, to: Date): number {
  if (to <= from) return 0;

  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));

  let count = 0;
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}
