import { useEffect, useRef, useState, type ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"
import * as L from "leaflet"
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Home,
  Info,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  BLUE,
  INCOME_STOPS,
  NAVY,
  incomeFill,
  neighborhoodByName,
  parseCount,
  tradeArea,
  type Lease,
  type Neighborhood,
  type Site,
} from "./data/tradeArea"

const SITE_TITLE = "Manhattan F&B Market Study"
const GEOJSON_URL = `${import.meta.env.BASE_URL}data/Tracts_26_Neighborhoods.geojson`
const MILES_TO_METERS = 1609.344
const ANALYSIS_PDF = `${import.meta.env.BASE_URL}Manhattan_Trade_Area_Analysis_11-23-2026.pdf`

/** Quiet OSM-based tiles: street grid + names, no landuse orange/ferry dashes. */
const CARTO_KEY = import.meta.env.VITE_CARTO_API_KEY ?? ""
const BASEMAP_URL = CARTO_KEY
  ? `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`
  : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
const BASEMAP_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'

type MapMode = "sites" | "neighborhoods"
type LayerKey =
  | "income"
  | "labels"
  | "radius025"
  | "radius05"
  | "sites"
  | "leases"
type LatLngTuple = [number, number]
type SitesFocus = "site" | "comparable"
type SiteTab = "1" | "2" | "6"
type HoodTab = "3" | "4" | "5"
type ChartId = "1" | "2" | "3" | "4" | "5" | "6"

const CHART_NAMES: Record<ChartId, string> = {
  "1": "Trade Area Demand Drivers",
  "2": "Ground-Floor Retail Rental Ranges",
  "3": "Population, Employees & Asking Rents",
  "4": "Residential & Workforce Detail",
  "5": "Foot Traffic by Time of Day",
  "6": "Food & Beverage Committed Lease Comparables",
}
const chartLabel = (id: ChartId) => `Chart ${id}: ${CHART_NAMES[id]}`

type TocItem = {
  id: string
  number: string
  label: string
  title: string
  children: { id: string; label: string }[]
}

const TOC: TocItem[] = [
  {
    id: "home",
    number: "",
    label: "Home",
    title: "Home",
    children: [],
  },
  {
    id: "sites-corridors",
    number: "I",
    label: "Sites & Corridors",
    title: "I Sites & Corridors (Charts 1, 2 and 6)",
    children: [
      { id: "chart-1", label: chartLabel("1") },
      { id: "chart-2", label: chartLabel("2") },
      { id: "chart-6", label: chartLabel("6") },
    ],
  },
  {
    id: "neighborhoods",
    number: "II",
    label: "Neighborhoods",
    title: "II Neighborhoods (Charts 3, 4 and 5)",
    children: [
      { id: "chart-3", label: chartLabel("3") },
      { id: "chart-4", label: chartLabel("4") },
      { id: "chart-5", label: chartLabel("5") },
    ],
  },
  {
    id: "sources",
    number: "III",
    label: "References & Sources",
    title: "III References & Sources",
    children: [],
  },
]

/** Pixel nudges so neighboring neighborhood labels do not overlap. */
const LABEL_OFFSETS: Record<string, [number, number]> = {
  "Meatpacking District": [-18, -10],
  "Greenwich Village": [0, -12],
  NoHo: [10, 10],
  "TriBeCa (Waterfront Core)": [-34, -12],
  "TriBeCa (Broadway/Civic)": [34, 12],
  "Hudson Square": [-22, 2],
  SoHo: [10, -2],
}

/** URLs and bare census hosts are linked with a short hostname as link text. */
const URL_RE =
  /(https?:\/\/\S+)|(\b(?:(?:api|data|lehd\.ces)\.census\.gov|doi\.org)(?:\/[^\s,;]*)?)/gi

function shortHost(href: string) {
  try {
    return new URL(href).hostname.replace(/^www\./, "")
  } catch {
    return href
  }
}

function linkifySource(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  let last = 0
  const matches = [...text.matchAll(URL_RE)]
  matches.forEach((match, i) => {
    const start = match.index ?? 0
    if (start > last) parts.push(text.slice(last, start))
    const raw = match[0].replace(/[.,;:]+$/, "")
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    parts.push(
      <a key={`${i}-${raw}`} href={href} target="_blank" rel="noreferrer">
        {shortHost(href)}
      </a>,
    )
    last = start + raw.length
  })
  if (last < text.length) parts.push(text.slice(last))
  return parts.length ? parts : [text]
}

/** Reference [3] lists five separate sources; show each on its own line. */
function sourceLines(no: string, source: string): string[] {
  if (no !== "3") return [source]
  return source.split(
    /(?<=\.)\s+(?=New York University,|The New School, Fall|The Cooper Union,|Cardozo School of Law,)/,
  )
}

function ringCentroid(ring: number[][]): LatLngTuple {
  let area = 0
  let x = 0
  let y = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j]!
    const [x1, y1] = ring[i]!
    const f = x0 * y1 - x1 * y0
    area += f
    x += (x0 + x1) * f
    y += (y0 + y1) * f
  }
  area *= 0.5
  if (Math.abs(area) < 1e-12) {
    const mid = ring[Math.floor(ring.length / 2)]!
    return [mid[1]!, mid[0]!]
  }
  return [y / (6 * area), x / (6 * area)]
}

function featureCentroid(geometry: GeoJSON.Geometry): LatLngTuple | null {
  if (geometry.type === "Polygon") {
    return ringCentroid(geometry.coordinates[0] as number[][])
  }
  if (geometry.type === "MultiPolygon") {
    let best: LatLngTuple | null = null
    let bestLen = -1
    for (const poly of geometry.coordinates) {
      const ring = poly[0] as number[][]
      if (ring.length > bestLen) {
        bestLen = ring.length
        best = ringCentroid(ring)
      }
    }
    return best
  }
  return null
}

function markerHtml(site: Site) {
  const { shape, color } = site.marker
  if (shape === "star") {
    return `<span class="site-marker star" style="color:${color}">★</span>`
  }
  if (shape === "triangle") {
    return `<span class="site-marker triangle" style="border-bottom-color:${color}"></span>`
  }
  return `<span class="site-marker circle" style="background:${color}"></span>`
}

function scrollToId(id: string) {
  const el = document.getElementById(id)
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
}

const ALL_SITE_IDS = tradeArea.sites.map((s) => s.id)
const ALL_HOOD_NAMES = tradeArea.neighborhoods.map((n) => n.name)
const ALL_LEASE_INDEXES = tradeArea.leases.map((_, i) => i)
const DEFAULT_SITE_ID =
  tradeArea.sites.find((s) => s.id === "washington")?.id ?? ALL_SITE_IDS[0]

/** Offset well away from site markers so comps stay clickable. */
const LEASE_PINS: { leaseIndex: number; position: LatLngTuple }[] = [
  { leaseIndex: 0, position: [40.7264, -73.9914] },
  { leaseIndex: 1, position: [40.7292, -73.9908] },
  { leaseIndex: 2, position: [40.7331, -73.9898] },
]

function incomeBandLabel(n: Neighborhood | undefined): string | null {
  if (!n?.medianIncomeSort) return null
  const color = incomeFill(n)
  return INCOME_STOPS.find((s) => s.color === color)?.label ?? null
}

const fmtNumber = (v: unknown) => Number(v).toLocaleString("en-US")

function TradeMap({
  mode,
  layers,
  focus,
  selectedNames,
  selectedIncomeBand,
  selectedSiteIds,
  selectedLeaseIndexes,
  onSelect,
  onSelectSite,
  onSelectLease,
}: {
  mode: MapMode
  layers: Record<LayerKey, boolean>
  focus?: SitesFocus
  selectedNames: string[]
  selectedIncomeBand?: string | null
  selectedSiteIds?: string[]
  selectedLeaseIndexes?: number[]
  onSelect: (n: Neighborhood) => void
  onSelectSite?: (site: Site) => void
  onSelectLease?: (index: number) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tractsLayerRef = useRef<L.GeoJSON | null>(null)
  const labelsLayerRef = useRef<L.LayerGroup | null>(null)
  const radiiLayerRef = useRef<L.LayerGroup | null>(null)
  const sitesLayerRef = useRef<L.LayerGroup | null>(null)
  const leasesLayerRef = useRef<L.LayerGroup | null>(null)
  const firstFocusRef = useRef(true)
  const selectedRef = useRef(selectedNames)
  const layersRef = useRef(layers)
  const bandRef = useRef(selectedIncomeBand ?? null)
  const modeRef = useRef(mode)
  selectedRef.current = selectedNames
  layersRef.current = layers
  bandRef.current = selectedIncomeBand ?? null
  modeRef.current = mode

  const styleFor: L.StyleFunction = (feature) => {
    const name = feature?.properties?.neighborhood as string
    const n = neighborhoodByName[name]
    const hoodMode = modeRef.current === "neighborhoods"
    const names = selectedRef.current
    const showIncome = hoodMode && layersRef.current.income
    const highlight =
      hoodMode && names.length > 0 && names.length < tradeArea.neighborhoods.length
    const selected = names.includes(name)
    const dimOthers = highlight && !selected
    const band = showIncome ? bandRef.current : null
    const bandMatch = !band || incomeBandLabel(n) === band
    let fillOpacity = dimOthers
      ? 0.12
      : showIncome
        ? 0.7
        : hoodMode
          ? 0.12
          : 0.18
    if (band) fillOpacity = bandMatch ? 0.88 : 0.08
    return {
      color: highlight && selected ? NAVY : hoodMode ? "#ffffff" : "#9bb6cb",
      weight: highlight && selected ? 2.5 : hoodMode ? 0.6 : 1,
      opacity: 1,
      fillColor: showIncome ? incomeFill(n) : "#d6e2ec",
      fillOpacity,
    }
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      scrollWheelZoom: true,
      zoomControl: true,
    }).setView([40.732, -73.992], mode === "sites" ? 13 : 16.25)

    L.tileLayer(BASEMAP_URL, {
      attribution: BASEMAP_ATTR,
      maxZoom: 20,
      subdomains: "abcd",
    }).addTo(map)

    const tracts = L.geoJSON(undefined, {
      style: styleFor,
      onEachFeature: (feature, layer) => {
        const name = feature.properties?.neighborhood as string
        const n = neighborhoodByName[name]
        if (!n) return
        layer.on({
          mouseover: (e) => {
            if (modeRef.current !== "neighborhoods") return
            const target = e.target as L.Path
            target.setStyle({ weight: 2, color: NAVY })
            target.bringToFront()
          },
          mouseout: (e) => {
            tracts.resetStyle(e.target)
          },
          click: () => {
            if (modeRef.current === "neighborhoods") onSelect(n)
          },
        })
      },
    }).addTo(map)
    tractsLayerRef.current = tracts

    fetch(GEOJSON_URL)
      .then((r) => r.json())
      .then((geo: GeoJSON.FeatureCollection) => {
        tracts.addData(geo)
        if (modeRef.current === "neighborhoods") {
          map.fitBounds(tracts.getBounds(), {
            padding: [56, 56],
            maxZoom: 16.5,
          })
        }

        const buckets: Record<string, LatLngTuple[]> = {}
        for (const feature of geo.features) {
          const name = feature.properties?.neighborhood as string
          if (!name || !feature.geometry) continue
          const c = featureCentroid(feature.geometry)
          if (!c) continue
          ;(buckets[name] ??= []).push(c)
        }
        const labels = labelsLayerRef.current
        if (labels) {
          labels.clearLayers()
          for (const [name, pts] of Object.entries(buckets)) {
            const lat = pts.reduce((s, p) => s + p[0], 0) / pts.length
            const lng = pts.reduce((s, p) => s + p[1], 0) / pts.length
            const [dx, dy] = LABEL_OFFSETS[name] ?? [0, 0]
            L.marker([lat, lng], {
              interactive: false,
              icon: L.divIcon({
                className: "hood-label",
                html: `<span style="transform:translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))">${name}</span>`,
                iconSize: [0, 0],
              }),
            }).addTo(labels)
          }
        }
      })

    labelsLayerRef.current = L.layerGroup().addTo(map)
    radiiLayerRef.current = L.layerGroup().addTo(map)
    sitesLayerRef.current = L.layerGroup().addTo(map)
    leasesLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    tractsLayerRef.current?.setStyle(styleFor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.income, selectedNames, selectedIncomeBand, mode])

  useEffect(() => {
    const labels = labelsLayerRef.current
    const map = mapRef.current
    if (!labels || !map) return
    const show = mode === "neighborhoods" && layers.labels
    if (show) {
      if (!map.hasLayer(labels)) labels.addTo(map)
    } else if (map.hasLayer(labels)) {
      map.removeLayer(labels)
    }
  }, [layers.labels, mode])

  useEffect(() => {
    const group = radiiLayerRef.current
    if (!group) return
    group.clearLayers()
    if (mode !== "sites") return
    const radii: [number, boolean][] = [
      [0.25, layers.radius025],
      [0.5, layers.radius05],
    ]
    for (const site of tradeArea.sites) {
      for (const [miles, on] of radii) {
        if (!on) continue
        L.circle(site.position, {
          radius: miles * MILES_TO_METERS,
          color: site.marker.color,
          weight: miles === 0.25 ? 2 : 1.5,
          dashArray: miles === 0.5 ? "5 5" : undefined,
          fillColor: site.marker.color,
          fillOpacity: 0.04,
        }).addTo(group)
      }
    }
  }, [layers.radius025, layers.radius05, mode])

  useEffect(() => {
    const group = sitesLayerRef.current
    if (!group) return
    group.clearLayers()
    // Site markers belong to the Sites & Corridors map only.
    if (mode !== "sites" || !layers.sites) return
    const siteIds = selectedSiteIds ?? []
    const highlightSites =
      focus !== "comparable" &&
      siteIds.length > 0 &&
      siteIds.length < tradeArea.sites.length
    for (const site of tradeArea.sites) {
      const selected = highlightSites && siteIds.includes(site.id)
      const icon = L.divIcon({
        className: `site-icon${selected ? " is-selected" : ""}`,
        html: markerHtml(site),
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      })
      const marker = L.marker(site.position, {
        icon,
        zIndexOffset: 600,
      })
      if (onSelectSite) marker.on("click", () => onSelectSite(site))
      marker.addTo(group)
    }
  }, [layers.sites, mode, focus, selectedSiteIds, onSelectSite])

  useEffect(() => {
    const group = leasesLayerRef.current
    if (!group) return
    group.clearLayers()
    if (mode !== "sites" || !layers.leases) return
    const leaseIdx = selectedLeaseIndexes ?? []
    const highlightLeases =
      focus === "comparable" &&
      leaseIdx.length > 0 &&
      leaseIdx.length < tradeArea.leases.length
    for (const pin of LEASE_PINS) {
      const lease = tradeArea.leases[pin.leaseIndex]
      if (!lease) continue
      const selected = highlightLeases && leaseIdx.includes(pin.leaseIndex)
      const icon = L.divIcon({
        className: `lease-icon${selected ? " is-selected" : ""}`,
        html: `<span class="lease-pin">${pin.leaseIndex + 1}</span>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      })
      const marker = L.marker(pin.position, { icon, zIndexOffset: 400 })
      if (onSelectLease) {
        marker.on("click", () => onSelectLease(pin.leaseIndex))
      }
      marker.addTo(group)
    }
  }, [layers.leases, mode, focus, selectedLeaseIndexes, onSelectLease])

  // Zoom in close on a single site / comp; otherwise frame everything selected.
  useEffect(() => {
    const map = mapRef.current
    if (!map || mode !== "sites") return
    const animate = !firstFocusRef.current
    firstFocusRef.current = false

    let single: LatLngTuple | null = null
    let pts: LatLngTuple[] = []
    if (focus === "comparable") {
      const idx = selectedLeaseIndexes ?? []
      const pins = LEASE_PINS.filter((p) => idx.includes(p.leaseIndex))
      if (pins.length === 1) single = pins[0]!.position
      else if (pins.length > 1 && pins.length < LEASE_PINS.length) {
        pts = pins.map((p) => p.position)
      }
    } else {
      const ids = selectedSiteIds ?? []
      const sel = tradeArea.sites.filter((s) => ids.includes(s.id))
      if (sel.length === 1) single = sel[0]!.position
      else if (sel.length > 1 && sel.length < tradeArea.sites.length) {
        pts = sel.map((s) => s.position)
      }
    }

    if (single) {
      map.setView(single, 14, { animate })
      return
    }
    const includeComps = layers.leases
    const bounds = L.latLngBounds(
      pts.length
        ? pts
        : [
            ...tradeArea.sites.map((s) => s.position as LatLngTuple),
            ...(includeComps ? LEASE_PINS.map((p) => p.position) : []),
          ],
    )
    map.fitBounds(bounds, { padding: [72, 72], maxZoom: 13, animate })
  }, [mode, focus, layers.leases, selectedSiteIds, selectedLeaseIndexes])

  return <div ref={containerRef} className="map-canvas" />
}

function TableOfContents({
  open,
  setOpen,
  active,
}: {
  open: boolean
  setOpen: (value: boolean) => void
  active: string
}) {
  const navigate = (id: string) => {
    scrollToId(id)
    if (window.innerWidth < 900) setOpen(false)
  }

  return (
    <>
      <button
        className="toc-mobile-trigger"
        onClick={() => setOpen(true)}
        aria-label="Open table of contents"
      >
        <Menu size={19} /> Contents
      </button>
      <AnimatePresence>
        {open && (
          <motion.button
            className="toc-backdrop"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
        )}
      </AnimatePresence>
      <motion.aside
        className={`toc ${open ? "is-open" : ""}`}
        animate={{ width: open ? 300 : 72 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
      >
        <div className="toc-top">
          {open && <span>Contents</span>}
          <button
            onClick={() => setOpen(!open)}
            aria-label={open ? "Collapse contents" : "Expand contents"}
          >
            {open ? <PanelLeftClose size={19} /> : <PanelLeftOpen size={19} />}
          </button>
          <button
            className="toc-close-mobile"
            onClick={() => setOpen(false)}
            aria-label="Close contents"
          >
            <X size={20} />
          </button>
        </div>
        <nav aria-label="Site sections">
          {TOC.map((section) => (
            <div className="toc-group" key={section.id}>
              <a
                className={active === section.id ? "active" : ""}
                href={`#${section.id}`}
                title={section.title}
                aria-label={section.title}
                onClick={(e) => {
                  e.preventDefault()
                  navigate(section.id)
                }}
              >
                <b className={section.id === "home" ? "toc-home-icon" : undefined}>
                  {section.id === "home" ? (
                    <Home size={16} strokeWidth={2.25} aria-hidden="true" />
                  ) : (
                    section.number
                  )}
                </b>
                {open && <span>{section.label}</span>}
              </a>
              {open && section.children.length > 0 && (
                <div className="toc-sub">
                  {section.children.map((child) => (
                    <a
                      key={child.id}
                      href={`#${child.id}`}
                      title={child.label}
                      onClick={(e) => {
                        e.preventDefault()
                        navigate(child.id)
                      }}
                    >
                      {child.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="toc-group toc-download">
            <a
              href={ANALYSIS_PDF}
              target="_blank"
              rel="noreferrer"
              aria-label="Open Analysis PDF"
              title="Analysis PDF"
            >
              <b>
                <FileText size={14} />
              </b>
              {open && <span>Analysis PDF</span>}
            </a>
          </div>
        </nav>
      </motion.aside>
    </>
  )
}

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && a.every((id) => b.includes(id))
}

function selectionLabel(
  count: number,
  total: number,
  singular: string,
  allWord = "All",
) {
  if (count === 0) return "None Selected"
  if (count === total) return `${allWord} (${total})`
  if (count === 1) return `1 ${singular}`
  return `${count} of ${total}`
}

function useMenuDismiss(open: boolean, onClose: () => void) {
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open, onClose])
  return rootRef
}

const CHART_NOTES: Record<ChartId, readonly string[]> = {
  "1": [
    "Population and Hotel Rooms are for 5- and 10-minute walks (RadiusMapper). Walk-time areas are not drawn on the map.",
    "Employees and Student Enrollment use the 0.25- and 0.5-mile straight-line radii shown on the map.",
  ],
  "2": [
    "Chart 2 is under construction. The rental ranges are estimates and are still being verified. They will be added here once confirmed. The current estimates are in the Analysis PDF.",
  ],
  "3": [
    tradeArea.clickSourceLine,
    "Full comparison tables are in the analysis PDF.",
  ],
  "4": [
    tradeArea.clickSourceLine,
    "“$250K+” means at least one tract is at the Census top code ($250,001), so the true figure is a minimum.",
    "Map income shading uses the same Median HH Income bands as this chart.",
    "Full comparison tables are in the analysis PDF.",
  ],
  "5": [
    tradeArea.credits.footTraffic,
    "Figures are modeled pedestrians per hour by time window.",
    "Full comparison tables are in the analysis PDF.",
  ],
  "6": [
    "Committed F&B lease comparables from the analysis package (same deals as the PDF).",
    "Asking rent and annual base rent are as reported in the source comps.",
  ],
}

const CHART3_FOOTNOTE_NOTES = tradeArea.chart3Footnotes.map((fn) =>
  fn.marker.length <= 2 ? `${fn.marker} ${fn.text}` : `${fn.marker}: ${fn.text}`,
)

function NoteTip({
  notes,
  label,
  variant = "default",
}: {
  notes: readonly string[]
  label: string
  variant?: "default" | "chart3"
}) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const rootRef = useMenuDismiss(open, close)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <span className="note-tip" ref={rootRef}>
      <button
        type="button"
        className="note-tip-btn"
        aria-label={`${label} notes`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Info size={14} strokeWidth={2.25} />
      </button>
      {open ? (
        <div
          className={`note-tip-popover${variant === "chart3" ? " chart3" : ""}`}
          role="dialog"
          aria-label={`${label} notes`}
        >
          <div className="note-tip-head">
            <span className="note-tip-title">Notes</span>
            <button
              type="button"
              className="note-tip-close"
              aria-label="Close notes"
              onClick={close}
            >
              <X size={14} strokeWidth={2.25} />
            </button>
          </div>
          {variant === "chart3" ? (
            <>
              <p className="note-section-label">Reading notes</p>
              <ul>
                {notes.map((note) => (
                  <li key={note}>
                    <NoteLine text={note} />
                  </li>
                ))}
              </ul>
              <p className="note-section-label">Asking-rent footnotes</p>
              <ul>
                {CHART3_FOOTNOTE_NOTES.map((note) => (
                  <li key={note}>
                    <NoteLine text={note} />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <ul>
              {notes.map((note) => (
                <li key={note}>
                  <NoteLine text={note} />
                </li>
              ))}
            </ul>
          )}
          <a href="#sources" onClick={close}>
            References &amp; Sources
          </a>
        </div>
      ) : null}
    </span>
  )
}

function ChartHeading({
  chart,
  extraNotes,
  dek,
  actions,
}: {
  chart: ChartId
  extraNotes?: readonly string[]
  dek?: string
  actions?: ReactNode
}) {
  const notes = extraNotes?.length
    ? [...CHART_NOTES[chart], ...extraNotes]
    : CHART_NOTES[chart]
  const title = chartLabel(chart)
  return (
    <div className="chart-heading-block">
      <div className={`chart-heading${actions ? " with-actions" : ""}`}>
        <div className="chart-heading-title">
          <h4>{title}</h4>
          <NoteTip
            notes={notes}
            label={title}
            variant={chart === "3" ? "chart3" : "default"}
          />
        </div>
        {actions}
      </div>
      {dek ? <p className="chart-dek">{dek}</p> : null}
    </div>
  )
}

type SortDir = "asc" | "desc"
type SortState = { key: string; dir: SortDir } | null

function isNaDisplay(value: string): boolean {
  const t = value.trim()
  return !t || t === "N/A" || t.startsWith("N/A")
}

/** Numeric sort key; N/A sorts last regardless of direction. */
function sortableNumber(value: string): number | null {
  if (isNaDisplay(value)) return null
  return parseCount(value.replace(/[†‡§*]/g, ""))
}

function compareNullable(
  a: number | null,
  b: number | null,
  dir: SortDir,
): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return dir === "asc" ? a - b : b - a
}

function compareText(a: string, b: string, dir: SortDir): number {
  const aNa = isNaDisplay(a)
  const bNa = isNaDisplay(b)
  if (aNa && bNa) return 0
  if (aNa) return 1
  if (bNa) return -1
  const cmp = a.localeCompare(b, undefined, { sensitivity: "base" })
  return dir === "asc" ? cmp : -cmp
}

function sortNeighborhoods(
  rows: Neighborhood[],
  sort: SortState,
  getValue: (row: Neighborhood, key: string) => string,
  kind: "num" | "text" = "num",
): Neighborhood[] {
  if (!sort) return rows
  const sorted = [...rows]
  sorted.sort((a, b) => {
    const av = getValue(a, sort.key)
    const bv = getValue(b, sort.key)
    if (kind === "text") return compareText(av, bv, sort.dir)
    return compareNullable(sortableNumber(av), sortableNumber(bv), sort.dir)
  })
  return sorted
}

function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
  className,
  sticky,
  rowSpan,
}: {
  label: string
  sortKey: string
  sort: SortState
  onSort: (key: string) => void
  className?: string
  sticky?: boolean
  rowSpan?: number
}) {
  const active = sort?.key === sortKey
  const dir = active ? sort?.dir : undefined
  const ariaSort =
    dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"
  return (
    <th
      rowSpan={rowSpan}
      aria-sort={ariaSort}
      className={`${sticky ? "sticky-col " : ""}${className ?? ""}`.trim()}
    >
      <button
        type="button"
        className={`sort-th-btn${dir ? ` sorted ${dir}` : ""}`}
        onClick={() => onSort(sortKey)}
        aria-label={
          dir === "asc"
            ? `${label}, sorted ascending`
            : dir === "desc"
              ? `${label}, sorted descending`
              : `Sort by ${label}`
        }
      >
        <span>{label}</span>
        <span className="sort-arrows" data-dir={dir ?? "none"} aria-hidden="true">
          <ChevronUp
            size={12}
            strokeWidth={dir === "asc" ? 3 : 2.25}
            className={dir === "asc" ? "on" : ""}
          />
          <ChevronDown
            size={12}
            strokeWidth={dir === "desc" ? 3 : 2.25}
            className={dir === "desc" ? "on" : ""}
          />
        </span>
      </button>
    </th>
  )
}

function useColumnSort() {
  const [sort, setSort] = useState<SortState>(null)
  const onSort = (key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" }
      if (prev.dir === "asc") return { key, dir: "desc" }
      return null
    })
  }
  const reset = () => setSort(null)
  return { sort, onSort, reset }
}

function ResetOrderButton({
  active,
  onReset,
}: {
  active: boolean
  onReset: () => void
}) {
  if (!active) return null
  return (
    <button type="button" className="clear-link reset-order" onClick={onReset}>
      Reset order
    </button>
  )
}

function DataTable({ children }: { children: ReactNode }) {
  return (
    <div className="data-table-wrap">
      <table className="data-table">{children}</table>
    </div>
  )
}

function HoodNameCell({
  hood,
  onPick,
}: {
  hood: Neighborhood
  onPick: (name: string) => void
}) {
  return (
    <td className="sticky-col">
      <button
        type="button"
        className="table-link"
        onClick={() => onPick(hood.name)}
      >
        {hood.name}
      </button>
      <span className="table-sub">{hood.group}</span>
    </td>
  )
}

function RentCell({ value }: { value: string }) {
  const m = value.match(/^(.*?)([†‡§*]+)?$/)
  const base = m?.[1] ?? value
  const mark = m?.[2]
  return (
    <>
      {base}
      {mark ? <sup className="rent-mark">{mark}</sup> : null}
    </>
  )
}

/** Render leading † ‡ § markers as superscript in notes / footnotes. */
function NoteLine({ text }: { text: string }) {
  const m = text.match(/^([†‡§*]+)(\s*)(.*)$/)
  if (!m) return <>{text}</>
  return (
    <>
      <sup className="rent-mark">{m[1]}</sup>
      {m[2]}
      {m[3]}
    </>
  )
}

function chart3FootnoteLine(hoods: Neighborhood[]) {
  const parts: ReactNode[] = []
  if (hoods.some((h) => h.askingRent.includes("†"))) {
    parts.push(
      <span key="dagger">
        <sup className="rent-mark">†</sup> NNN rent.
      </span>,
    )
  }
  if (hoods.some((h) => h.askingRent.includes("‡"))) {
    parts.push(
      <span key="double">
        <sup className="rent-mark">‡</sup> Single quote.
      </span>,
    )
  }
  if (!parts.length) return null
  return (
    <p className="table-footnote-line">
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 ? " " : null}
          {part}
        </span>
      ))}
    </p>
  )
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
  allIds,
  allLabel = "All",
  singular = "selected",
}: {
  label: string
  options: { id: string; label: string }[]
  selected: string[]
  onChange: (ids: string[]) => void
  allIds: string[]
  allLabel?: string
  singular?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useMenuDismiss(open, () => setOpen(false))
  const isAll = sameSet(selected, allIds)
  const summary = isAll
    ? allLabel
    : selected.length === 1
      ? (options.find((o) => o.id === selected[0])?.label ?? "1 Selected")
      : selectionLabel(selected.length, allIds.length, singular)

  const toggle = (id: string) => {
    if (isAll) {
      onChange([id])
      return
    }
    if (selected.includes(id)) {
      onChange(selected.filter((x) => x !== id))
    } else {
      const next = [...selected, id]
      onChange(sameSet(next, allIds) ? [...allIds] : next)
    }
  }

  return (
    <div className="multi-select" ref={rootRef}>
      <span className="multi-select-label">{label}</span>
      <button
        type="button"
        className="multi-select-trigger"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{summary}</span>
        <span className="multi-select-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div className="multi-select-menu" role="listbox" aria-multiselectable>
          <div className="menu-actions">
            <button
              type="button"
              className={isAll ? "active" : ""}
              onClick={() => onChange([...allIds])}
            >
              {allLabel}
            </button>
            <button
              type="button"
              className={selected.length === 0 ? "active" : ""}
              onClick={() => onChange([])}
            >
              Clear All
            </button>
          </div>
          {options.map((opt) => (
            <label
              key={opt.id}
              className={!isAll && selected.includes(opt.id) ? "active" : ""}
            >
              <input
                type="checkbox"
                checked={isAll || selected.includes(opt.id)}
                onChange={() => toggle(opt.id)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SitesCompsSelect({
  focus,
  setFocus,
  selectedSiteIds,
  setSelectedSiteIds,
  selectedLeaseIndexes,
  setSelectedLeaseIndexes,
}: {
  focus: SitesFocus
  setFocus: (f: SitesFocus) => void
  selectedSiteIds: string[]
  setSelectedSiteIds: (ids: string[]) => void
  selectedLeaseIndexes: number[]
  setSelectedLeaseIndexes: (indexes: number[]) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useMenuDismiss(open, () => setOpen(false))
  const sitesAll = sameSet(selectedSiteIds, ALL_SITE_IDS)
  const compsAll = sameSet(
    selectedLeaseIndexes.map(String),
    ALL_LEASE_INDEXES.map(String),
  )
  const summary =
    focus === "site"
      ? sitesAll
        ? "All Target Corridors"
        : selectedSiteIds.length === 1
          ? (tradeArea.sites.find((s) => s.id === selectedSiteIds[0])
              ?.address ?? "1 Target Corridor")
          : selectionLabel(
              selectedSiteIds.length,
              tradeArea.sites.length,
              "Target Corridor",
            )
      : compsAll
        ? "All Lease Comps"
        : selectedLeaseIndexes.length === 1
          ? `${selectedLeaseIndexes[0]! + 1}. ${tradeArea.leases[selectedLeaseIndexes[0]!]?.tenant}`
          : selectionLabel(
              selectedLeaseIndexes.length,
              tradeArea.leases.length,
              "Lease Comp",
            )

  const toggleSite = (id: string) => {
    setFocus("site")
    if (focus !== "site" || sitesAll) {
      setSelectedSiteIds([id])
      return
    }
    if (selectedSiteIds.includes(id)) {
      const next = selectedSiteIds.filter((x) => x !== id)
      setSelectedSiteIds(next.length ? next : [...ALL_SITE_IDS])
    } else {
      const next = [...selectedSiteIds, id]
      setSelectedSiteIds(sameSet(next, ALL_SITE_IDS) ? [...ALL_SITE_IDS] : next)
    }
  }

  const toggleComp = (index: number) => {
    setFocus("comparable")
    if (focus !== "comparable" || compsAll) {
      setSelectedLeaseIndexes([index])
      return
    }
    if (selectedLeaseIndexes.includes(index)) {
      const next = selectedLeaseIndexes.filter((x) => x !== index)
      setSelectedLeaseIndexes(next.length ? next : [...ALL_LEASE_INDEXES])
    } else {
      const next = [...selectedLeaseIndexes, index]
      setSelectedLeaseIndexes(
        next.length === ALL_LEASE_INDEXES.length ? [...ALL_LEASE_INDEXES] : next,
      )
    }
  }

  return (
    <div className="multi-select" ref={rootRef}>
      <span className="multi-select-label">Target Corridors &amp; Lease Comps</span>
      <div className="multi-select-control">
        <button
          type="button"
          className="multi-select-trigger"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span>{summary}</span>
          <span className="multi-select-caret" aria-hidden="true">
            ▾
          </span>
        </button>
        {open ? (
          <div className="multi-select-menu sites-comps-menu" role="listbox">
            <p className="menu-section">Target Corridors</p>
            <button
              type="button"
              className={focus === "site" && sitesAll ? "active" : ""}
              onClick={() => {
                setFocus("site")
                setSelectedSiteIds([...ALL_SITE_IDS])
              }}
            >
              All Target Corridors
            </button>
            {tradeArea.sites.map((s) => (
              <label
                key={s.id}
                className={
                  focus === "site" &&
                  !sitesAll &&
                  selectedSiteIds.includes(s.id)
                    ? "active"
                    : ""
                }
              >
                <input
                  type="checkbox"
                  checked={
                    focus === "site" &&
                    (sitesAll || selectedSiteIds.includes(s.id))
                  }
                  onChange={() => toggleSite(s.id)}
                />
                {s.address}
              </label>
            ))}
            <p className="menu-section">Lease Comps</p>
            <button
              type="button"
              className={focus === "comparable" && compsAll ? "active" : ""}
              onClick={() => {
                setFocus("comparable")
                setSelectedLeaseIndexes([...ALL_LEASE_INDEXES])
              }}
            >
              All Lease Comps
            </button>
            {tradeArea.leases.map((l, i) => (
              <label
                key={l.tenant}
                className={
                  focus === "comparable" &&
                  !compsAll &&
                  selectedLeaseIndexes.includes(i)
                    ? "active"
                    : ""
                }
              >
                <input
                  type="checkbox"
                  checked={
                    focus === "comparable" &&
                    (compsAll || selectedLeaseIndexes.includes(i))
                  }
                  onChange={() => toggleComp(i)}
                />
                {i + 1}. {l.tenant}
              </label>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function SitesDetailPanel({
  focus,
  setFocus,
  siteTab,
  setSiteTab,
  selectedSiteIds,
  setSelectedSiteIds,
  selectedLeaseIndexes,
  setSelectedLeaseIndexes,
  showLeasePins,
  onToggleLeasePins,
  onPickSite,
  onPickLease,
}: {
  focus: SitesFocus
  setFocus: (f: SitesFocus) => void
  siteTab: SiteTab
  setSiteTab: (t: SiteTab) => void
  selectedSiteIds: string[]
  setSelectedSiteIds: (ids: string[]) => void
  selectedLeaseIndexes: number[]
  setSelectedLeaseIndexes: (indexes: number[]) => void
  showLeasePins: boolean
  onToggleLeasePins: () => void
  onPickSite: (site: Site) => void
  onPickLease: (index: number) => void
}) {
  const sites = tradeArea.sites.filter((s) => selectedSiteIds.includes(s.id))
  const leaseRows: { lease: Lease; index: number }[] = tradeArea.leases
    .map((lease, index) => ({ lease, index }))
    .filter(({ index }) => selectedLeaseIndexes.includes(index))
  const singleSite = sites.length === 1 ? sites[0]! : null
  const singleLease = leaseRows.length === 1 ? leaseRows[0]! : null
  const partialSites = sites.length < tradeArea.sites.length
  const partialLeases = leaseRows.length < tradeArea.leases.length

  const chartData = singleSite
    ? [
        {
          label: "Population 5-Min",
          value: parseCount(singleSite.population5min),
        },
        {
          label: "Population 10-Min",
          value: parseCount(singleSite.population10min),
        },
        {
          label: "Employees 0.25-Mile",
          value: parseCount(singleSite.employees025),
        },
        {
          label: "Employees 0.5-Mile",
          value: parseCount(singleSite.employees05),
        },
      ]
    : []

  return (
    <aside className="detail-panel" id="sites-detail">
      <div className="detail-panel-head">
        <p className="eyebrow">
          {focus === "comparable"
            ? "Lease Comparables"
            : singleSite
              ? "Target Corridor"
              : "Target Corridors"}
        </p>
        <div className="detail-panel-title-row">
          <h3>
            {focus === "comparable"
              ? singleLease
                ? `${singleLease.index + 1}. ${singleLease.lease.tenant}`
                : selectionLabel(
                    leaseRows.length,
                    tradeArea.leases.length,
                    "Lease Comp",
                    "All Lease Comps",
                  )
              : singleSite
                ? singleSite.corridor
                : selectionLabel(
                    sites.length,
                    tradeArea.sites.length,
                    "Target Corridor",
                    "All Target Corridors",
                  )}
          </h3>
          {focus === "site" && partialSites ? (
            <button
              type="button"
              className="clear-link"
              onClick={() => setSelectedSiteIds([...ALL_SITE_IDS])}
            >
              Show All
            </button>
          ) : null}
          {focus === "comparable" && partialLeases ? (
            <button
              type="button"
              className="clear-link"
              onClick={() => setSelectedLeaseIndexes([...ALL_LEASE_INDEXES])}
            >
              Show All
            </button>
          ) : null}
        </div>
        {focus === "comparable" && singleLease ? (
          <p className="chart-dek">{singleLease.lease.address}</p>
        ) : null}
        {focus === "site" && singleSite ? (
          <p className="chart-dek">{singleSite.address}</p>
        ) : null}
      </div>

      <div className="panel-tabs" role="tablist" aria-label="Site Charts">
        {(["1", "2", "6"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={siteTab === id}
            className={siteTab === id ? "active" : ""}
            onClick={() => setSiteTab(id)}
          >
            {chartLabel(id)}
          </button>
        ))}
      </div>

      <div className="detail-panel-body">
        {siteTab === "1" ? (
          <div id="chart-1">
            <ChartHeading chart="1" />
            {singleSite ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d5dee6" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtNumber} />
                  <Tooltip formatter={(v) => fmtNumber(v)} />
                  <Bar dataKey="value" name="Count" fill={BLUE} />
                </BarChart>
              </ResponsiveContainer>
            ) : null}
            <DataTable>
              <thead>
                <tr>
                  <th className="sticky-col">Target Corridor</th>
                  <th>Address</th>
                  <th>Population 5-Min</th>
                  <th>Population 10-Min</th>
                  <th>Employees 0.25-Mile</th>
                  <th>Employees 0.5-Mile</th>
                  <th>Student Enrollment</th>
                  <th>Hotel Rooms 5-Min</th>
                  <th>Hotel Rooms 10-Min</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id}>
                    <td className="sticky-col">
                      <button
                        type="button"
                        className="table-link"
                        onClick={() => onPickSite(s)}
                      >
                        {s.corridor}
                      </button>
                    </td>
                    <td>{s.address}</td>
                    <td>{s.population5min}</td>
                    <td>{s.population10min}</td>
                    <td>{s.employees025}</td>
                    <td>{s.employees05}</td>
                    <td>{s.students05}</td>
                    <td>{s.hotels5min}</td>
                    <td>{s.hotels10min}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        ) : null}

        {siteTab === "2" ? (
          <div id="chart-2" className="held">
            <ChartHeading chart="2" />
            <div className="held-box">
              Chart 2 is under construction. The rental ranges are estimates and
              are still being verified. They will be added here once confirmed.
              The current estimates are in the Analysis PDF.
            </div>
          </div>
        ) : null}

        {siteTab === "6" ? (
          <div id="chart-6">
            <ChartHeading
              chart="6"
              actions={
                <label className="chart-heading-action">
                  <input
                    type="checkbox"
                    checked={showLeasePins}
                    onChange={onToggleLeasePins}
                  />
                  Display locations on map
                </label>
              }
            />
            <DataTable>
              <thead>
                <tr>
                  <th className="sticky-col">Tenant Brand / Concept</th>
                  <th>Address / Corridor</th>
                  <th>Square Feet (SF) Total</th>
                  <th>Asking Rent ($/SF)</th>
                  <th>Annual Base Rent ($/SF)</th>
                  <th>Date</th>
                  <th className="wide-col">Deal Notes</th>
                </tr>
              </thead>
              <tbody>
                {leaseRows.map(({ lease: l, index }) => (
                  <tr key={l.tenant}>
                    <td className="sticky-col">
                      <button
                        type="button"
                        className="table-link"
                        onClick={() => onPickLease(index)}
                      >
                        {index + 1}. {l.tenant}
                      </button>
                    </td>
                    <td className="wrap-cell">{l.address}</td>
                    <td>{l.sf}</td>
                    <td>{l.askingRent}</td>
                    <td>{l.annualBaseRent}</td>
                    <td>{l.date}</td>
                    <td className="wrap-cell wide-col">{l.notes}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        ) : null}
      </div>
    </aside>
  )
}

const TRAFFIC_WINDOWS = [
  { key: "8-9 AM", label: "8–9 AM" },
  { key: "12:30-1:30 PM", label: "12:30–1:30 PM" },
  { key: "5-6 PM", label: "5–6 PM" },
] as const

function chart3Value(hood: Neighborhood, key: string): string {
  switch (key) {
    case "name":
      return hood.name
    case "population":
      return hood.population
    case "employees":
      return hood.employees
    case "kids":
      return hood.householdsWithKids
    case "hh150":
      return hood.hhOver150k
    case "hh200":
      return hood.hhOver200k
    case "rent":
      return hood.askingRent
    default:
      return ""
  }
}

function chart4Value(hood: Neighborhood, key: string): string {
  switch (key) {
    case "name":
      return hood.name
    case "median":
      return hood.medianHhIncome
    case "average":
      return hood.averageHhIncome
    case "bachelors":
      return hood.bachelorsOrHigher
    case "sectors":
      return hood.topJobSectors
    case "anchors":
      return hood.anchorCompanies
    default:
      return ""
  }
}

function chart5Value(hood: Neighborhood, key: string): string {
  if (key === "name") return hood.name
  if (key.startsWith("wd:")) {
    return hood.footTraffic.weekday[key.slice(3)] ?? "N/A"
  }
  if (key.startsWith("we:")) {
    return hood.footTraffic.weekend[key.slice(3)] ?? "N/A"
  }
  return ""
}

function NeighborhoodDetailPanel({
  tab,
  setTab,
  selectedNames,
  setSelectedNames,
}: {
  tab: HoodTab
  setTab: (t: HoodTab) => void
  selectedNames: string[]
  setSelectedNames: (names: string[]) => void
}) {
  const hoods = tradeArea.neighborhoods.filter((n) =>
    selectedNames.includes(n.name),
  )
  const single = hoods.length === 1 ? hoods[0]! : null
  const pick = (name: string) => setSelectedNames([name])
  const sort3 = useColumnSort()
  const sort4 = useColumnSort()
  const sort5 = useColumnSort()

  const chart3Kind =
    sort3.sort?.key === "name" ? ("text" as const) : ("num" as const)
  const chart4Kind =
    sort4.sort?.key === "name" ||
    sort4.sort?.key === "sectors" ||
    sort4.sort?.key === "anchors"
      ? ("text" as const)
      : ("num" as const)
  const chart5Kind =
    sort5.sort?.key === "name" ? ("text" as const) : ("num" as const)

  const rows3 = sortNeighborhoods(hoods, sort3.sort, chart3Value, chart3Kind)
  const rows4 = sortNeighborhoods(hoods, sort4.sort, chart4Value, chart4Kind)
  const rows5 = sortNeighborhoods(hoods, sort5.sort, chart5Value, chart5Kind)

  const ageData = single
    ? Object.entries(single.age).map(([band, value]) => ({
        band,
        value: parseCount(value),
      }))
    : []
  const incomeData = single
    ? [
        {
          label: "Median",
          value: single.medianIncomeSort ?? 0,
          display: single.medianHhIncome,
        },
        {
          label: "Average",
          value: parseCount(
            single.averageHhIncome.replace("K", "000").replace("+", ""),
          ),
          display: single.averageHhIncome,
        },
      ]
    : []
  const trafficData = single
    ? TRAFFIC_WINDOWS.map((w) => ({
        window: w.label,
        Weekdays: parseCount(single.footTraffic.weekday[w.key]!),
        Weekend: parseCount(single.footTraffic.weekend[w.key]!),
      }))
    : []

  const emptyNote = (
    <p className="empty-note">
      No neighborhoods selected. Use the selector or click the map to choose
      one or more.
    </p>
  )

  return (
    <aside className="detail-panel" id="neighborhoods-detail">
      <div className="detail-panel-head">
        <p className="eyebrow">Neighborhoods</p>
        <div className="detail-panel-title-row">
          <h3>
            {single
              ? single.name
              : selectionLabel(
                  selectedNames.length,
                  tradeArea.neighborhoods.length,
                  "Neighborhood",
                  "All Neighborhoods",
                )}
          </h3>
          {hoods.length < tradeArea.neighborhoods.length ? (
            <button
              type="button"
              className="clear-link"
              onClick={() => setSelectedNames([...ALL_HOOD_NAMES])}
            >
              Show All
            </button>
          ) : null}
        </div>
        {single ? <p className="chart-dek">{single.group}</p> : null}
      </div>
      <div className="panel-tabs" role="tablist" aria-label="Neighborhood Charts">
        {(["3", "4", "5"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {chartLabel(id)}
          </button>
        ))}
      </div>
      <div className="detail-panel-body">
        {tab === "3" && (
          <div id="chart-3">
            <ChartHeading
              chart="3"
              actions={
                <ResetOrderButton
                  active={!!sort3.sort}
                  onReset={sort3.reset}
                />
              }
            />
            {single ? (
              <>
                <p className="chart-dek">Age Mix by Share of Population (Estimate)</p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={ageData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d5dee6" />
                    <XAxis dataKey="band" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => `${fmtNumber(v)}%`}
                    />
                    <Tooltip
                      formatter={(v) => `${Number(v).toFixed(1)}%`}
                    />
                    <Bar dataKey="value" name="Age Mix (Estimate)" fill={BLUE} />
                  </BarChart>
                </ResponsiveContainer>
              </>
            ) : null}
            {hoods.length === 0 ? (
              emptyNote
            ) : (
              <>
                <DataTable>
                  <thead>
                    <tr>
                      <SortableTh
                        sticky
                        label="Neighborhood"
                        sortKey="name"
                        sort={sort3.sort}
                        onSort={sort3.onSort}
                      />
                      <SortableTh
                        label="Population"
                        sortKey="population"
                        sort={sort3.sort}
                        onSort={sort3.onSort}
                      />
                      <SortableTh
                        label="Employees"
                        sortKey="employees"
                        sort={sort3.sort}
                        onSort={sort3.onSort}
                      />
                      <SortableTh
                        label="W/ Kids"
                        sortKey="kids"
                        sort={sort3.sort}
                        onSort={sort3.onSort}
                      />
                      <SortableTh
                        label="HH >$150K"
                        sortKey="hh150"
                        sort={sort3.sort}
                        onSort={sort3.onSort}
                      />
                      <SortableTh
                        label="HH >$200K"
                        sortKey="hh200"
                        sort={sort3.sort}
                        onSort={sort3.onSort}
                      />
                      <SortableTh
                        label="Asking Rent (Blended $/SF)"
                        sortKey="rent"
                        sort={sort3.sort}
                        onSort={sort3.onSort}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {rows3.map((hood) => (
                      <tr key={hood.name}>
                        <HoodNameCell hood={hood} onPick={pick} />
                        <td>{hood.population}</td>
                        <td>{hood.employees}</td>
                        <td>{hood.householdsWithKids}</td>
                        <td>{hood.hhOver150k}</td>
                        <td>{hood.hhOver200k}</td>
                        <td>
                          <RentCell value={hood.askingRent} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
                {chart3FootnoteLine(rows3)}
              </>
            )}
          </div>
        )}
        {tab === "4" && (
          <div id="chart-4">
            <ChartHeading
              chart="4"
              actions={
                <ResetOrderButton
                  active={!!sort4.sort}
                  onReset={sort4.reset}
                />
              }
            />
            {single ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={incomeData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d5dee6" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `$${fmtNumber(Math.round(Number(v) / 1000))}K`}
                  />
                  <Tooltip
                    formatter={(_v, _n, item) => [
                      (item?.payload as { display?: string })?.display ?? _v,
                      "Income (Estimate)",
                    ]}
                  />
                  <Bar dataKey="value" fill={BLUE} />
                </BarChart>
              </ResponsiveContainer>
            ) : null}
            {hoods.length === 0 ? (
              emptyNote
            ) : (
              <DataTable>
                <thead>
                  <tr>
                    <SortableTh
                      sticky
                      label="Neighborhood"
                      sortKey="name"
                      sort={sort4.sort}
                      onSort={sort4.onSort}
                    />
                    <SortableTh
                      label="Median HH Income"
                      sortKey="median"
                      sort={sort4.sort}
                      onSort={sort4.onSort}
                    />
                    <SortableTh
                      label="Average HH Income"
                      sortKey="average"
                      sort={sort4.sort}
                      onSort={sort4.onSort}
                    />
                    <SortableTh
                      label="Bachelor's Degree or Higher"
                      sortKey="bachelors"
                      sort={sort4.sort}
                      onSort={sort4.onSort}
                    />
                    <SortableTh
                      label="Top Three Job Sectors"
                      sortKey="sectors"
                      sort={sort4.sort}
                      onSort={sort4.onSort}
                      className="sector-col"
                    />
                    <SortableTh
                      label="Anchor Companies"
                      sortKey="anchors"
                      sort={sort4.sort}
                      onSort={sort4.onSort}
                      className="anchor-col"
                    />
                  </tr>
                </thead>
                <tbody>
                  {rows4.map((hood) => (
                    <tr key={hood.name}>
                      <HoodNameCell hood={hood} onPick={pick} />
                      <td>{hood.medianHhIncome}</td>
                      <td>{hood.averageHhIncome}</td>
                      <td>{hood.bachelorsOrHigher}</td>
                      <td className="wrap-cell sector-col">
                        {hood.topJobSectors}
                      </td>
                      <td className="wrap-cell anchor-col">
                        {hood.anchorCompanies}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </div>
        )}
        {tab === "5" && (
          <div id="chart-5">
            <ChartHeading
              chart="5"
              dek="Modeled pedestrians per hour on a typical weekday and weekend day, by time of day."
              extraNotes={
                selectedNames.includes("Gramercy Park")
                  ? [tradeArea.gramercyNote]
                  : undefined
              }
              actions={
                <ResetOrderButton
                  active={!!sort5.sort}
                  onReset={sort5.reset}
                />
              }
            />
            {single ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={trafficData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d5dee6" />
                  <XAxis dataKey="window" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtNumber} />
                  <Tooltip formatter={(v) => fmtNumber(v)} />
                  <Legend />
                  <Bar dataKey="Weekdays" fill={NAVY} />
                  <Bar dataKey="Weekend" fill="#5f87a8" />
                </BarChart>
              </ResponsiveContainer>
            ) : null}
            {hoods.length === 0 ? (
              emptyNote
            ) : (
              <DataTable>
                <thead>
                  <tr>
                    <SortableTh
                      sticky
                      rowSpan={2}
                      label="Neighborhood"
                      sortKey="name"
                      sort={sort5.sort}
                      onSort={sort5.onSort}
                    />
                    <th className="group-head" colSpan={3}>
                      Weekdays
                    </th>
                    <th className="group-head" colSpan={3}>
                      Weekend
                    </th>
                  </tr>
                  <tr>
                    {TRAFFIC_WINDOWS.map((w) => (
                      <SortableTh
                        key={`wd-${w.key}`}
                        label={w.label}
                        sortKey={`wd:${w.key}`}
                        sort={sort5.sort}
                        onSort={sort5.onSort}
                        className="sub-head"
                      />
                    ))}
                    {TRAFFIC_WINDOWS.map((w) => (
                      <SortableTh
                        key={`we-${w.key}`}
                        label={w.label}
                        sortKey={`we:${w.key}`}
                        sort={sort5.sort}
                        onSort={sort5.onSort}
                        className="sub-head"
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows5.map((hood) => (
                    <tr key={hood.name}>
                      <HoodNameCell hood={hood} onPick={pick} />
                      {TRAFFIC_WINDOWS.map((w) => (
                        <td key={`wd-${w.key}`}>
                          {hood.footTraffic.weekday[w.key]}
                        </td>
                      ))}
                      {TRAFFIC_WINDOWS.map((w) => (
                        <td key={`we-${w.key}`}>
                          {hood.footTraffic.weekend[w.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}

function SourcesSection() {
  return (
    <section className="view-section sources-section" id="sources">
      <header className="view-header">
        <h2>References &amp; Sources</h2>
        <p>
          Footnotes and sources for the Manhattan Trade Area Analysis, November
          2026. Approximate figures are labeled estimate, modeled, or broker
          estimate. Click the (i) next to any panel header for chart-specific
          notes.
        </p>
      </header>

      <div className="sources-layout">
        <article className="chart-panel">
          <h3>Numbered Sources</h3>
          <p className="chart-dek">Numbering matches the analysis report.</p>
          <ol className="source-list">
            {tradeArea.references.map((ref) => (
              <li key={ref.no} id={`source-${ref.no}`}>
                <strong>[{ref.no}]</strong>
                <span>
                  {sourceLines(ref.no, ref.source).map((line) => (
                    <span className="source-line" key={line}>
                      {linkifySource(line)}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ol>
        </article>
      </div>
    </section>
  )
}

function HomeHero({ onExplore }: { onExplore: () => void }) {
  return (
    <section className="hero" id="home">
      <div className="hero-grid" aria-hidden="true" />
      <div className="hero-layout">
        <div className="hero-inner">
          <img
            className="hero-logo"
            src={`${import.meta.env.BASE_URL}sir-logo.svg`}
            alt="Sotheby’s International Realty"
          />
          <h1>{SITE_TITLE}</h1>
          <p className="hero-dek">
            An interactive walk through Manhattan sites and neighborhoods —
            where the target neighborhoods sit, who lives and works there, and
            how the three target corridors compare. Every figure was manually
            picked and verified for this presentation from{" "}
            <a className="hero-inline-link" href="#sources">
              References &amp; Sources
            </a>
            .
          </p>
          <div className="hero-actions">
            <button type="button" className="hero-action" onClick={onExplore}>
              Explore Sites &amp; Corridors <span>↓</span>
            </button>
            <button
              type="button"
              className="hero-action ghost"
              onClick={() => scrollToId("neighborhoods")}
            >
              Neighborhoods <span>↓</span>
            </button>
          </div>
          <div className="hero-meta">
            <span>Updated {tradeArea.updated}</span>
            <span>26 Neighborhoods · 3 Target Corridors</span>
          </div>
        </div>
        <div className="hero-map" aria-hidden="true">
          <img
            src={`${import.meta.env.BASE_URL}manhattan-locator.png`}
            alt=""
          />
        </div>
      </div>
    </section>
  )
}

export default function App() {
  const [tocOpen, setTocOpen] = useState(false)
  const [active, setActive] = useState("home")
  const [selectedHoodNames, setSelectedHoodNames] = useState<string[]>([
    ...ALL_HOOD_NAMES,
  ])
  const [sitesFocus, setSitesFocus] = useState<SitesFocus>("site")
  const [siteTab, setSiteTab] = useState<SiteTab>("1")
  const [hoodTab, setHoodTab] = useState<HoodTab>("3")
  const [selectedIncomeBand, setSelectedIncomeBand] = useState<string | null>(
    null,
  )
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([
    DEFAULT_SITE_ID,
  ])
  const [selectedLeaseIndexes, setSelectedLeaseIndexes] = useState<number[]>([
    ...ALL_LEASE_INDEXES,
  ])

  const setSitesFocusAndTab = (focus: SitesFocus) => {
    setSitesFocus(focus)
    setSiteTab((prev) => {
      if (focus === "comparable") return "6"
      return prev === "6" ? "1" : prev
    })
  }

  const selectSiteTab = (tab: SiteTab) => {
    setSiteTab(tab)
    setSitesFocus(tab === "6" ? "comparable" : "site")
  }
  const [siteLayers, setSiteLayers] = useState<Record<LayerKey, boolean>>({
    income: false,
    labels: false,
    radius025: true,
    radius05: true,
    sites: true,
    leases: false,
  })
  const [hoodLayers, setHoodLayers] = useState<Record<LayerKey, boolean>>({
    income: true,
    labels: true,
    radius025: false,
    radius05: false,
    sites: false,
    leases: false,
  })

  const pickSite = (site: Site) => {
    setSelectedSiteIds([site.id])
    setSitesFocus("site")
    setSiteTab("1")
  }
  const pickLease = (index: number) => {
    setSelectedLeaseIndexes([index])
    setSitesFocus("comparable")
    setSiteTab("6")
  }
  const pickHood = (n: Neighborhood) => {
    setSelectedHoodNames([n.name])
  }
  const pickIncomeBand = (label: string) => {
    setSelectedIncomeBand((prev) => (prev === label ? null : label))
    setHoodLayers((prev) => (prev.income ? prev : { ...prev, income: true }))
  }

  useEffect(() => {
    document.title = SITE_TITLE
  }, [])

  useEffect(() => {
    const ids = [
      "home",
      "sites-corridors",
      "neighborhoods",
      "sources",
      "sites-detail",
      "neighborhoods-detail",
    ]
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (!visible?.target.id) return
        const id = visible.target.id
        if (id === "sites-detail") setActive("sites-corridors")
        else if (id === "neighborhoods-detail") setActive("neighborhoods")
        else setActive(id)
      },
      { rootMargin: "-35% 0px -45% 0px", threshold: [0.1, 0.4] },
    )
    for (const id of ids) {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [])

  // TOC chart links → switch tab + scroll to the right view
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a[href^='#chart-']")
      if (!a) return
      const id = a.getAttribute("href")?.slice(1)
      if (!id) return
      e.preventDefault()
      if (id === "chart-1" || id === "chart-2") {
        setSitesFocus("site")
        setSiteTab(id.slice(-1) as SiteTab)
        setSelectedSiteIds([...ALL_SITE_IDS])
        scrollToId("sites-detail")
      } else if (id === "chart-6") {
        setSitesFocus("comparable")
        setSiteTab("6")
        setSelectedLeaseIndexes([...ALL_LEASE_INDEXES])
        scrollToId("sites-detail")
      } else if (id === "chart-3" || id === "chart-4" || id === "chart-5") {
        setSelectedHoodNames([...ALL_HOOD_NAMES])
        setHoodTab(id.slice(-1) as HoodTab)
        scrollToId("neighborhoods-detail")
      }
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [])

  const siteHighlight =
    sitesFocus === "site" && selectedSiteIds.length < tradeArea.sites.length
  const leaseHighlight =
    sitesFocus === "comparable" &&
    selectedLeaseIndexes.length < tradeArea.leases.length

  return (
    <div className={`app ${tocOpen ? "toc-expanded" : ""}`}>
      <TableOfContents open={tocOpen} setOpen={setTocOpen} active={active} />
      <main>
        <HomeHero onExplore={() => scrollToId("sites-corridors")} />

        <section className="view-section" id="sites-corridors">
          <header className="view-header with-filter">
            <div className="view-header-copy">
              <h2>Sites &amp; Corridors</h2>
              <p>Select a site or lease comp, or click a marker on the map.</p>
            </div>
            <SitesCompsSelect
              focus={sitesFocus}
              setFocus={setSitesFocusAndTab}
              selectedSiteIds={selectedSiteIds}
              setSelectedSiteIds={setSelectedSiteIds}
              selectedLeaseIndexes={selectedLeaseIndexes}
              setSelectedLeaseIndexes={setSelectedLeaseIndexes}
            />
          </header>

          <div className="map-toolbar">
            <div className="layer-toggles">
              {(
                [
                  ["radius025", "0.25-Mile Radius"],
                  ["radius05", "0.5-Mile Radius"],
                  ["leases", "Comparables"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={siteLayers[key]}
                    onChange={() =>
                      setSiteLayers((prev) => ({ ...prev, [key]: !prev[key] }))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <div
              className="map-legend-keys map-legend"
              role="group"
              aria-label="Target Corridors and Lease Comps"
            >
              <div className="site-key">
                <span className="key-label">Target Corridors</span>
                {tradeArea.sites.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`legend-btn${siteHighlight && selectedSiteIds.includes(s.id) ? " active" : ""}`}
                    title={`Select and zoom to ${s.address}`}
                    onClick={() => pickSite(s)}
                  >
                    <span dangerouslySetInnerHTML={{ __html: markerHtml(s) }} />
                    {s.address}
                  </button>
                ))}
              </div>
              {siteLayers.leases ? (
                <div className="site-key comps-key">
                  <span className="key-label">Lease Comps</span>
                  {tradeArea.leases.map((l, i) => (
                    <button
                      key={l.tenant}
                      type="button"
                      className={`legend-btn${leaseHighlight && selectedLeaseIndexes.includes(i) ? " active" : ""}`}
                      title={`Open lease comp: ${l.tenant}`}
                      onClick={() => pickLease(i)}
                    >
                      <span className="lease-pin legend-pin">{i + 1}</span>
                      {l.tenant}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="map-stage single">
            <TradeMap
              mode="sites"
              layers={siteLayers}
              focus={sitesFocus}
              selectedNames={[]}
              selectedSiteIds={selectedSiteIds}
              selectedLeaseIndexes={selectedLeaseIndexes}
              onSelect={() => {}}
              onSelectSite={pickSite}
              onSelectLease={pickLease}
            />
          </div>
          <p className="map-hint">
            Population and Hotel Rooms use 5- and 10-minute walk areas;
            Employees and Student Enrollment use 0.25- and 0.5-mile
            straight-line radii.
          </p>
          {siteLayers.leases ? (
            <p className="map-hint">
              Click a numbered marker to view the lease comp.
            </p>
          ) : null}

          <div className="charts-below">
            <SitesDetailPanel
              focus={sitesFocus}
              setFocus={setSitesFocusAndTab}
              siteTab={siteTab}
              setSiteTab={selectSiteTab}
              selectedSiteIds={selectedSiteIds}
              setSelectedSiteIds={setSelectedSiteIds}
              selectedLeaseIndexes={selectedLeaseIndexes}
              setSelectedLeaseIndexes={setSelectedLeaseIndexes}
              showLeasePins={siteLayers.leases}
              onToggleLeasePins={() =>
                setSiteLayers((prev) => ({ ...prev, leases: !prev.leases }))
              }
              onPickSite={pickSite}
              onPickLease={pickLease}
            />
          </div>
        </section>

        <section className="view-section" id="neighborhoods">
          <header className="view-header with-filter">
            <div className="view-header-copy">
              <h2>Neighborhoods</h2>
              <p>
                All 26 neighborhoods by default as a comparison table. Click the
                map or use the selector to focus one or several; Clear All
                removes the selection.
              </p>
            </div>
            <MultiSelect
              label="Neighborhoods"
              allIds={ALL_HOOD_NAMES}
              selected={selectedHoodNames}
              onChange={setSelectedHoodNames}
              allLabel="All Neighborhoods"
              singular="Neighborhood"
              options={tradeArea.neighborhoods.map((hood) => ({
                id: hood.name,
                label: `${hood.name} · ${hood.group}`,
              }))}
            />
          </header>

          <div className="map-toolbar">
            <div className="layer-toggles">
              {(
                [
                  ["income", "Income Shading"],
                  ["labels", "Neighborhood Labels"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={hoodLayers[key]}
                    onChange={() => {
                      setHoodLayers((prev) => {
                        const next = { ...prev, [key]: !prev[key] }
                        if (key === "income" && !next.income) {
                          setSelectedIncomeBand(null)
                        }
                        return next
                      })
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
            {hoodLayers.income ? (
              <div
                className="map-legend-keys inline income-key"
                role="group"
                aria-label="Median HH Income"
              >
                <span className="key-label">Median HH Income</span>
                {INCOME_STOPS.map((stop) => (
                  <button
                    key={stop.label}
                    type="button"
                    className={`income-swatch button${
                      selectedIncomeBand === stop.label ? " active" : ""
                    }${
                      selectedIncomeBand && selectedIncomeBand !== stop.label
                        ? " dimmed"
                        : ""
                    }`}
                    aria-pressed={selectedIncomeBand === stop.label}
                    title={`Highlight ${stop.label} neighborhoods`}
                    onClick={() => pickIncomeBand(stop.label)}
                  >
                    <i style={{ background: stop.color }} />
                    {stop.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="map-stage single">
            <TradeMap
              mode="neighborhoods"
              layers={hoodLayers}
              selectedNames={selectedHoodNames}
              selectedIncomeBand={selectedIncomeBand}
              onSelect={pickHood}
            />
          </div>

          <div className="charts-below">
            <NeighborhoodDetailPanel
              tab={hoodTab}
              setTab={setHoodTab}
              selectedNames={selectedHoodNames}
              setSelectedNames={setSelectedHoodNames}
            />
          </div>
        </section>

        <SourcesSection />

        <footer className="app-footer">
          <img
            src={`${import.meta.env.BASE_URL}sir-logo.svg`}
            alt=""
            aria-hidden="true"
          />
          <div>
            <p>{tradeArea.credits.census}</p>
            <p>
              Base map: {tradeArea.credits.osm} · tiles © CARTO (light style).
            </p>
            <p>{tradeArea.credits.footTraffic}</p>
            <p>
              Full citations:{" "}
              <a href="#sources" style={{ color: "#9bb6cb" }}>
                References &amp; Sources
              </a>
              .
            </p>
          </div>
        </footer>
      </main>
    </div>
  )
}
