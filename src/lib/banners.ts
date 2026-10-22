/**
 * News banners: a line of text on a coloured strip above the map, for things like "Watford Junction
 * station is closed". The admin sets the message, colour, whether it is on, and when it shows.
 * Shared by the server and the browser.
 */

/** The colours a banner can have, each with a text colour that reads on it. */
export const BANNER_COLOURS = [
  { key: "navy", label: "Navy", background: "var(--color-navy)", text: "var(--color-white)" },
  { key: "blue", label: "Blue", background: "var(--color-blue)", text: "var(--color-white)" },
  { key: "amber", label: "Amber", background: "var(--color-amber)", text: "var(--color-ink)" },
  { key: "red", label: "Red", background: "var(--color-red)", text: "var(--color-white)" },
  { key: "green", label: "Green", background: "var(--color-green)", text: "var(--color-white)" },
] as const;

export type BannerColour = (typeof BANNER_COLOURS)[number]["key"];

export const isBannerColour = (value: string): value is BannerColour => BANNER_COLOURS.some((c) => c.key === value);

export const bannerColour = (key: string) => BANNER_COLOURS.find((c) => c.key === key) ?? BANNER_COLOURS[0];

export const MAX_BANNER_MESSAGE = 140;

/** What the admin sets for a banner. `id` is absent for a new one. */
export interface BannerInput {
  id?: number;
  message: string;
  colour: BannerColour;
  /** Where the message links to, if anywhere (http or https). */
  link: string;
  /** Off banners are never shown, whatever the dates. */
  active: boolean;
  /** When it starts and stops showing (ISO times); null for no limit. */
  startsAt: string | null;
  endsAt: string | null;
}

export interface Banner extends BannerInput {
  id: number;
}

/** A banner as the map gets it. */
export type MapBanner = Pick<Banner, "id" | "message" | "colour" | "link" | "startsAt" | "endsAt">;

export type BannerStatus = "showing" | "scheduled" | "ended" | "off";

export function bannerStatus(banner: Pick<Banner, "active" | "startsAt" | "endsAt">, now = Date.now()): BannerStatus {
  if (!banner.active) return "off";
  if (banner.endsAt && Date.parse(banner.endsAt) <= now) return "ended";
  if (banner.startsAt && Date.parse(banner.startsAt) > now) return "scheduled";
  return "showing";
}

export const isShowing = (banner: Pick<Banner, "active" | "startsAt" | "endsAt">, now = Date.now()) =>
  bannerStatus(banner, now) === "showing";

// The admin works in UK time, wherever the server (or the admin) is.
const LONDON = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function londonParts(ms: number): Record<string, string> {
  return Object.fromEntries(LONDON.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
}

/** How far UK time is ahead of UTC at that moment, in ms. */
function londonOffsetMs(ms: number): number {
  const minute = Math.floor(ms / 60_000) * 60_000;
  const p = londonParts(minute);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - minute;
}

/** A form's date and time ("2026-12-24T09:30", read as UK time) as an ISO time; null if empty or invalid. */
export function londonInputToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  // The offset depends on the instant itself (clocks change), so settle it in two steps.
  const ms = asUtc - londonOffsetMs(asUtc - londonOffsetMs(asUtc));
  const back = londonParts(ms);
  if (+back.day !== day || +back.hour !== hour || +back.minute !== minute) return null;
  return new Date(ms).toISOString();
}

/** An ISO time as a form's date and time in UK time; "" for none. */
export function isoToLondonInput(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const p = londonParts(ms);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** An ISO time written for the admin, in UK time (e.g. "24 Dec 2026, 09:30"). */
export function formatLondon(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
