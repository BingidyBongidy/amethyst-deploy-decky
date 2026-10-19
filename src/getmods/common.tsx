import { NexusCard, TsCard } from "../shared";

/** 12345 -> "12.3k", 4200000 -> "4.2M". */
export function compact(n: number | undefined | null): string {
  const v = Number(n) || 0;
  const fmt = (x: number, unit: string) => `${x >= 100 ? Math.round(x) : x.toFixed(1).replace(/\.0$/, "")}${unit}`;
  if (v >= 1e9) return fmt(v / 1e9, "B");
  if (v >= 1e6) return fmt(v / 1e6, "M");
  if (v >= 1e3) return fmt(v / 1e3, "k");
  return String(Math.round(v));
}

/** "2024-05-01T12:00:00Z" -> "2024-05-01"; anything unparseable is returned as is. */
export const day = (s: string) => (s && /^\d{4}-\d\d-\d\d/.test(s) ? s.slice(0, 10) : s || "");

export type Source = "nexus" | "ts";

/** One result card, whichever site it came from. */
export type Item =
  | { src: "nexus"; key: string; card: NexusCard }
  | { src: "ts"; key: string; card: TsCard };

export const itemName = (it: Item) => (it.src === "nexus" ? it.card.name : it.card.label || it.card.name);

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
