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

/** Shared navy ramp — darker = higher value. */
export const SHADE_COLORS = [
  "#d6e2ec",
  "#9bb6cb",
  "#5f87a8",
  "#2f5f84",
  "#002349",
] as const

export const SHADE_NA = "#c5d3de"

export type ShadeStop = { max: number; color: string; label: string }

/** Navy family aligned to Sotheby's blue — darker = higher income. */
export const INCOME_STOPS: readonly ShadeStop[] = [
  { max: 120_000, color: SHADE_COLORS[0], label: "< $120K" },
  { max: 150_000, color: SHADE_COLORS[1], label: "$120–150K" },
  { max: 180_000, color: SHADE_COLORS[2], label: "$150–180K" },
  { max: 210_000, color: SHADE_COLORS[3], label: "$180–210K" },
  { max: Infinity, color: SHADE_COLORS[4], label: "$210K+" },
]

export const POPULATION_STOPS: readonly ShadeStop[] = [
  { max: 5_000, color: SHADE_COLORS[0], label: "< 5,000" },
  { max: 10_000, color: SHADE_COLORS[1], label: "5,000–10,000" },
  { max: 15_000, color: SHADE_COLORS[2], label: "10,000–15,000" },
  { max: 20_000, color: SHADE_COLORS[3], label: "15,000–20,000" },
  { max: Infinity, color: SHADE_COLORS[4], label: "20,000+" },
]

export const EMPLOYEE_STOPS: readonly ShadeStop[] = [
  { max: 5_000, color: SHADE_COLORS[0], label: "< 5,000" },
  { max: 15_000, color: SHADE_COLORS[1], label: "5,000–15,000" },
  { max: 30_000, color: SHADE_COLORS[2], label: "15,000–30,000" },
  { max: 50_000, color: SHADE_COLORS[3], label: "30,000–50,000" },
  { max: Infinity, color: SHADE_COLORS[4], label: "50,000+" },
]

/** Fixed bins across all foot-traffic windows (modeled pedestrians/hour). */
export const FOOT_TRAFFIC_STOPS: readonly ShadeStop[] = [
  { max: 200, color: SHADE_COLORS[0], label: "< 200" },
  { max: 400, color: SHADE_COLORS[1], label: "200–400" },
  { max: 600, color: SHADE_COLORS[2], label: "400–600" },
  { max: 900, color: SHADE_COLORS[3], label: "600–900" },
  { max: Infinity, color: SHADE_COLORS[4], label: "900+" },
]

export type FootTrafficDay = "weekday" | "weekend"
export type FootTrafficWindow = "8-9 AM" | "12:30-1:30 PM" | "5-6 PM"

export type ShadeMode =
  | { measure: "income" }
  | { measure: "population" }
  | { measure: "employees" }
  | {
      measure: "footTraffic"
      day: FootTrafficDay
      window: FootTrafficWindow
    }

export const DEFAULT_SHADE_MODE: ShadeMode = { measure: "income" }

export const FOOT_TRAFFIC_OPTIONS: {
  day: FootTrafficDay
  window: FootTrafficWindow
  label: string
}[] = [
  { day: "weekday", window: "8-9 AM", label: "Weekday 8–9 AM" },
  { day: "weekday", window: "12:30-1:30 PM", label: "Weekday 12:30–1:30 PM" },
  { day: "weekday", window: "5-6 PM", label: "Weekday 5–6 PM" },
  { day: "weekend", window: "8-9 AM", label: "Weekend 8–9 AM" },
  { day: "weekend", window: "12:30-1:30 PM", label: "Weekend 12:30–1:30 PM" },
  { day: "weekend", window: "5-6 PM", label: "Weekend 5–6 PM" },
]

export const NAVY = "#002349"
export const BLUE = "#1a3d66"

export function parseCount(value: string): number {
  if (!value || value === "N/A") return 0
  return Number(value.replace(/[^0-9.]/g, "")) || 0
}

function fillFromStops(
  value: number | null,
  stops: readonly ShadeStop[],
): string {
  if (value === null) return SHADE_NA
  for (const stop of stops) {
    if (value <= stop.max) return stop.color
  }
  return SHADE_COLORS[4]
}

function labelFromStops(
  value: number | null,
  stops: readonly ShadeStop[],
): string | null {
  if (value === null) return null
  for (const stop of stops) {
    if (value <= stop.max) return stop.label
  }
  return stops[stops.length - 1]?.label ?? null
}

export function shadeStops(mode: ShadeMode): readonly ShadeStop[] {
  switch (mode.measure) {
    case "income":
      return INCOME_STOPS
    case "population":
      return POPULATION_STOPS
    case "employees":
      return EMPLOYEE_STOPS
    case "footTraffic":
      return FOOT_TRAFFIC_STOPS
  }
}

export function shadeLegendTitle(mode: ShadeMode): string {
  switch (mode.measure) {
    case "income":
      return "Median HH Income (Estimate)"
    case "population":
      return "Population"
    case "employees":
      return "Employees"
    case "footTraffic": {
      const opt = FOOT_TRAFFIC_OPTIONS.find(
        (o) => o.day === mode.day && o.window === mode.window,
      )
      return `Foot Traffic (Modeled) · ${opt?.label ?? mode.window}`
    }
  }
}

export function shadeModeLabel(mode: ShadeMode): string {
  switch (mode.measure) {
    case "income":
      return "Median HH Income (Estimate)"
    case "population":
      return "Population"
    case "employees":
      return "Employees"
    case "footTraffic": {
      const opt = FOOT_TRAFFIC_OPTIONS.find(
        (o) => o.day === mode.day && o.window === mode.window,
      )
      return opt ? `Foot Traffic · ${opt.label}` : "Foot Traffic (Modeled)"
    }
  }
}

export function shadeValue(
  n: Neighborhood | undefined,
  mode: ShadeMode,
): number | null {
  if (!n) return null
  switch (mode.measure) {
    case "income":
      return n.medianIncomeSort
    case "population": {
      if (!n.population || n.population === "N/A") return null
      return parseCount(n.population)
    }
    case "employees": {
      if (!n.employees || n.employees === "N/A") return null
      return parseCount(n.employees)
    }
    case "footTraffic": {
      const raw = n.footTraffic[mode.day][mode.window]
      if (!raw || raw === "N/A") return null
      return parseCount(raw)
    }
  }
}

/** Map fill for the active Neighborhoods shading measure. */
export function shadeFill(
  n: Neighborhood | undefined,
  mode: ShadeMode,
): string {
  return fillFromStops(shadeValue(n, mode), shadeStops(mode))
}

export function shadeBandLabel(
  n: Neighborhood | undefined,
  mode: ShadeMode,
): string | null {
  return labelFromStops(shadeValue(n, mode), shadeStops(mode))
}

/** Map fill from Chart 4 median HH income (medianIncomeSort). */
export function incomeFill(n: Neighborhood | undefined): string {
  return shadeFill(n, { measure: "income" })
}
