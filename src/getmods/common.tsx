import { NexusCard, TsCard } from "../shared";

/** 12345 -> "12.3k", 4200000 -> "4.2M". */
export function compact(count: number | undefined | null): string {
  const value = Number(count) || 0;
  const scaled = (x: number, unit: string) => `${x >= 100 ? Math.round(x) : x.toFixed(1).replace(/\.0$/, "")}${unit}`;
  if (value >= 1e9) return scaled(value / 1e9, "B");
  if (value >= 1e6) return scaled(value / 1e6, "M");
  if (value >= 1e3) return scaled(value / 1e3, "k");
  return String(Math.round(value));
}

/** "2024-05-01T12:00:00Z" -> "2024-05-01"; anything unparseable is returned as is. */
export const day = (date: string) => (date && /^\d{4}-\d\d-\d\d/.test(date) ? date.slice(0, 10) : date || "");

export type Source = "nexus" | "ts";

export const SITE_NAMES: Record<Source, string> = { nexus: "Nexus Mods", ts: "Thunderstore" };

/** One result card, whichever site it came from. */
export type Item =
  | { src: "nexus"; key: string; card: NexusCard }
  | { src: "ts"; key: string; card: TsCard };

export const itemName = (item: Item) => (item.src === "nexus" ? item.card.name : item.card.label || item.card.name);

export const NEXUS_SORTS = [
  { data: "downloads", label: "Most downloaded" },
  { data: "endorsements", label: "Most endorsed" },
  { data: "updatedAt", label: "Recently updated" },
  { data: "createdAt", label: "Newest" },
];
export const TS_SORTS = [
  { data: "most-downloaded", label: "Most downloaded" },
  { data: "top-rated", label: "Top rated" },
  { data: "last-updated", label: "Recently updated" },
  { data: "newest", label: "Newest" },
];

/** Hide a thumbnail that failed to load, keeping its box so rows stay aligned. */
export const hideBroken = (e: { currentTarget: HTMLImageElement }) => {
  e.currentTarget.style.visibility = "hidden";
};
