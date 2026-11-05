// One way to write dates on every page, as the content guide asks: "12 May 2020", or "12 May" in tight
// spaces, never "12/05/2020" and never the browser's own order ("May 12, 2020").
// A date alone ("2020-05-12") is that calendar day wherever you are; a moment ("2020-05-12T09:30:00Z") is
// shown in your own time zone.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function parse(value: string | number | Date) {
  if (typeof value !== "string")
    return { at: new Date(value), zone: undefined };
  if (DAY.test(value))
    return { at: new Date(`${value}T12:00:00Z`), zone: "UTC" };
  return { at: new Date(value), zone: undefined };
}

function format(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions,
): string {
  const { at, zone } = parse(value);
  if (Number.isNaN(at.getTime())) return "";
  // en-GB writes September as "Sept"; the guide's short months are three letters.
  return at
    .toLocaleDateString("en-GB", { ...options, timeZone: zone })
    .replace("Sept", "Sep");
}

/** "12 May 2020". */
export function longDate(value: string | number | Date) {
  return format(value, { day: "numeric", month: "long", year: "numeric" });
}

/** "12 May 2020" with a short month: "3 Sep 2020". */
export function shortDate(value: string | number | Date) {
  return format(value, { day: "numeric", month: "short", year: "numeric" });
}

/** "12 May 2020, 09:30", in your own time zone. */
export function dateAndTime(value: string | number | Date) {
  const { at } = parse(value);
  if (Number.isNaN(at.getTime())) return "";
  const time = at.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${longDate(at)}, ${time}`;
}
