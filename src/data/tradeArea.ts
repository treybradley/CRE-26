import data from "./tradeArea.json"

export type SiteMarker = {
  shape: "star" | "circle" | "triangle"
  color: string
  label: string
}

export type Site = {
  id: string
  corridor: string
  address: string
  position: [number, number]
  marker: SiteMarker
  population5min: string
  population10min: string
  employees025: string
  employees05: string
  students05: string
  hotels5min: string
  hotels10min: string
}

export type Neighborhood = {
  name: string
  group: string
  age: Record<string, string>
  householdsWithKids: string
  hhOver150k: string
  hhOver200k: string
  population: string
  employees: string
  askingRent: string
  medianHhIncome: string
  averageHhIncome: string
  bachelorsOrHigher: string
  topJobSectors: string
  anchorCompanies: string
  medianIncomeSort: number | null
  medianTopCoded: boolean
  footTraffic: {
    weekday: Record<string, string>
    weekend: Record<string, string>
  }
  tracts: string[]
}

export type Lease = {
  tenant: string
  address: string
  sf: string
  askingRent: string
  annualBaseRent: string
  date: string
  notes: string
}

export const tradeArea = data as unknown as {
  updated: string
  sites: Site[]
  neighborhoods: Neighborhood[]
  leases: Lease[]
  references: { no: string; source: string }[]
  chart3Footnotes: { marker: string; text: string }[]
  hoverLine: string
  clickSourceLine: string
  credits: { osm: string; census: string; footTraffic: string }
  gramercyNote: string
}

export const neighborhoodByName = Object.fromEntries(
  tradeArea.neighborhoods.map((n) => [n.name, n]),
) as Record<string, Neighborhood>

/** Navy family aligned to Sotheby's blue — darker = higher income. */
export const INCOME_STOPS = [
  { max: 120_000, color: "#d6e2ec", label: "< $120K" },
  { max: 150_000, color: "#9bb6cb", label: "$120–150K" },
  { max: 180_000, color: "#5f87a8", label: "$150–180K" },
  { max: 210_000, color: "#2f5f84", label: "$180–210K" },
  { max: Infinity, color: "#002349", label: "$250K+" },
] as const

export const NAVY = "#002349"
export const BLUE = "#1a3d66"

export function incomeFill(n: Neighborhood | undefined): string {
  if (!n?.medianIncomeSort) return "#c5d3de"
  // Chart 4 “$250K+” is the Census top-code minimum — always darkest.
  if (n.medianHhIncome.includes("250K")) return "#002349"
  for (const stop of INCOME_STOPS) {
    if (n.medianIncomeSort <= stop.max) return stop.color
  }
  return "#002349"
}

export function parseCount(value: string): number {
  if (!value || value === "N/A") return 0
  return Number(value.replace(/[^0-9.]/g, "")) || 0
}
