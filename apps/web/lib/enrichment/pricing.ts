export type BidStatus =
  | "watching"
  | "capped"
  | "published"
  | "won"
  | "lost"
  | "skipped";

/** Extract Maxx event week key from a lot/event URL */
export function parseMaxxEventFromUrl(sourceUrl: string): {
  eventId: string | null;
  eventWeekKey: string;
  sourceLotId: string | null;
} {
  try {
    const u = new URL(sourceUrl);
    const path = u.pathname;

    const lotMatch = path.match(/\/Event\/LotDetails\/(\d+)/i);
    const eventDetails = path.match(/\/Event\/(?:Details|Index)\/(\d+)/i);
    const eventAny = path.match(/\/Event\/([^/]+)/i);

    const sourceLotId = lotMatch?.[1] ?? null;
    let eventId = eventDetails?.[1] ?? null;

    // Some Maxx URLs only have LotDetails — use lot id bucket as week proxy
    if (!eventId && eventAny?.[1] && !/^LotDetails$/i.test(eventAny[1])) {
      eventId = eventAny[1];
    }

    const eventWeekKey = eventId
      ? `maxx-event-${eventId}`
      : sourceLotId
        ? `maxx-lotweek-${sourceLotId.slice(0, 5)}`
        : `maxx-url-${sourceUrl.replace(/[^a-zA-Z0-9]/g, "").slice(-16)}`;

    return { eventId, eventWeekKey, sourceLotId };
  } catch {
    return {
      eventId: null,
      eventWeekKey: "maxx-unknown",
      sourceLotId: null,
    };
  }
}

/** True when event week key is a weak proxy (lot/url fallback, not a real event id). */
export function isWeakEventWeekKey(
  eventWeekKey: string | null | undefined
): boolean {
  if (!eventWeekKey) return true;
  return (
    eventWeekKey.startsWith("maxx-lotweek-") ||
    eventWeekKey.startsWith("maxx-url-") ||
    eventWeekKey === "maxx-unknown"
  );
}
