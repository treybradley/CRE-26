import { useEffect, useRef, useState, type ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"
import * as L from "leaflet"
import {
  FileText,
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
  type Neighborhood,
  type Site,
} from "./data/tradeArea"

const GEOJSON_URL = `${import.meta.env.BASE_URL}data/Tracts_26_Neighborhoods.geojson`
const MILES_TO_METERS = 1609.344
const ANALYSIS_PDF = `${import.meta.env.BASE_URL}Manhattan_Trade_Area_Analysis_11-15-2026.pdf`

/** Quiet OSM-based tiles: street grid + names, no landuse orange/ferry dashes. */
const CARTO_KEY = import.meta.env.VITE_CARTO_API_KEY ?? ""
const BASEMAP_URL = CARTO_KEY
  ? `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`
  : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
const BASEMAP_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'

type MapMode = "sites" | "neighborhoods"
type LayerKey = "income" | "labels" | "radii" | "sites" | "leases"
type LatLngTuple = [number, number]

const TOC = [
  {
    id: "home",
    number: "0",
    label: "Home",
    children: [] as { id: string; label: string }[],
  },
  {
    id: "sites-corridors",
    number: "I",
    label: "Sites & corridors",
    children: [
      { id: "chart-1", label: "Demand drivers" },
      { id: "chart-2", label: "Rental ranges" },
      { id: "chart-6", label: "Lease comps" },
    ],
  },
  {
    id: "neighborhoods",
    number: "II",
    label: "Neighborhoods",
    children: [
      { id: "chart-3", label: "Pop. & employees" },
      { id: "chart-4", label: "Workforce" },
      { id: "chart-5", label: "Foot traffic" },
    ],
  },
  {
    id: "sources",
    number: "III",
    label: "Sources & footnotes",
    children: [] as { id: string; label: string }[],
  },
] as const

const URL_RE = /(https?:\/\/[^\s)]+)|(doi\.org\/[^\s)]+)/gi

function linkifySource(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  let last = 0
  const matches = [...text.matchAll(URL_RE)]
  matches.forEach((match, i) => {
    const start = match.index ?? 0
    if (start > last) parts.push(text.slice(last, start))
    let href = match[0]
    if (href.startsWith("doi.org/")) href = `https://${href}`
    const clean = href.replace(/[.,;:]+$/, "")
    parts.push(
      <a key={`${i}-${clean}`} href={clean} target="_blank" rel="noreferrer">
        {clean}
      </a>,
    )
    last = start + match[0].length
  })
  if (last < text.length) parts.push(text.slice(last))
  return parts.length ? parts : [text]
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

function sitePopupHtml(site: Site) {
  return `
    <div class="map-popup">
      <strong>${site.address}</strong>
      <span class="muted">${site.corridor}</span>
      <hr />
      <div><b>Population 5-min</b> ${site.population5min}</div>
      <div><b>Population 10-min</b> ${site.population10min}</div>
      <div><b>Employees 0.25-mile</b> ${site.employees025}</div>
      <div><b>Employees 0.5-mile</b> ${site.employees05}</div>
      <div><b>Student enrollment (0.5 mile)</b> ${site.students05}</div>
      <div><b>Hotel rooms 5-min</b> ${site.hotels5min}</div>
      <div><b>Hotel rooms 10-min</b> ${site.hotels10min}</div>
      <p class="footnote">Walk-time figures are from RadiusMapper reports (not drawn). Employee counts use the 0.25- and 0.5-mile circles shown.</p>
    </div>
  `
}

function scrollToId(id: string) {
  const el = document.getElementById(id)
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
}

function TradeMap({
  mode,
  layers,
  selectedNames,
  selectedSiteIds,
  selectedLeaseIndexes,
  onSelect,
  onHover,
  onSelectSite,
  onSelectLease,
}: {
  mode: MapMode
  layers: Record<LayerKey, boolean>
  selectedNames: string[]
  selectedSiteIds?: string[]
  selectedLeaseIndexes?: number[]
  onSelect: (n: Neighborhood) => void
  onHover: (n: Neighborhood | null) => void
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
  const selectedRef = useRef(selectedNames)
  const modeRef = useRef(mode)
  selectedRef.current = selectedNames
  modeRef.current = mode

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      scrollWheelZoom: true,
      zoomControl: true,
    }).setView([40.732, -73.992], mode === "sites" ? 14.5 : 14)

    L.tileLayer(BASEMAP_URL, {
      attribution: BASEMAP_ATTR,
      maxZoom: 20,
      subdomains: "abcd",
    }).addTo(map)

    const tracts = L.geoJSON(undefined, {
      style: (feature) => {
        const name = feature?.properties?.neighborhood as string
        const n = neighborhoodByName[name]
        const selected = selectedRef.current.includes(name)
        const showIncome = modeRef.current === "neighborhoods"
        return {
          color: selected ? NAVY : showIncome ? "#ffffff" : "#9bb6cb",
          weight: selected ? 2.5 : showIncome ? 0.6 : 1,
          opacity: 1,
          fillColor: showIncome ? incomeFill(n) : "#d6e2ec",
          fillOpacity: showIncome ? 0.7 : 0.22,
        }
      },
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
            onHover(n)
          },
          mouseout: (e) => {
            tracts.resetStyle(e.target)
            onHover(null)
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
        if (mode === "sites") {
          const siteBounds = L.latLngBounds(
            tradeArea.sites.map((s) => s.position),
          )
          for (const pin of LEASE_PINS) siteBounds.extend(pin.position)
          map.fitBounds(siteBounds, { padding: [56, 56], maxZoom: 15 })
        } else {
          map.fitBounds(tracts.getBounds(), {
            padding: [40, 40],
            maxZoom: 15,
          })
          map.zoomIn()
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
            L.marker([lat, lng], {
              interactive: false,
              icon: L.divIcon({
                className: "hood-label",
                html: `<span>${name}</span>`,
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
    const tracts = tractsLayerRef.current
    if (!tracts) return
    const showIncome = mode === "neighborhoods" && layers.income
    const multi =
      mode === "neighborhoods" &&
      selectedNames.length > 0 &&
      selectedNames.length < tradeArea.neighborhoods.length
    tracts.setStyle((feature) => {
      const name = feature?.properties?.neighborhood as string
      const n = neighborhoodByName[name]
      const selected = selectedNames.includes(name)
      const dimOthers = multi && !selected
      return {
        color: selected && multi ? NAVY : mode === "neighborhoods" ? "#ffffff" : "#9bb6cb",
        weight: selected && multi ? 2.5 : mode === "neighborhoods" ? 0.6 : 1,
        fillColor: showIncome ? incomeFill(n) : "#d6e2ec",
        fillOpacity: dimOthers
          ? 0.12
          : showIncome
            ? 0.7
            : mode === "sites"
              ? 0.18
              : 0.12,
      }
    })
  }, [layers.income, selectedNames, mode])

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
    if (mode !== "sites" || !layers.radii) return
    for (const site of tradeArea.sites) {
      for (const miles of [0.25, 0.5]) {
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
  }, [layers.radii, mode])

  useEffect(() => {
    const group = sitesLayerRef.current
    if (!group) return
    group.clearLayers()
    if (!layers.sites) return
    const siteIds = selectedSiteIds ?? []
    const highlightSites =
      siteIds.length > 0 && siteIds.length < tradeArea.sites.length
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
      if (mode === "sites" && onSelectSite) {
        marker.on("click", () => onSelectSite(site))
      } else {
        marker.bindPopup(sitePopupHtml(site), { maxWidth: 320 })
      }
      marker.addTo(group)
    }
  }, [layers.sites, mode, selectedSiteIds, onSelectSite])

  useEffect(() => {
    const group = leasesLayerRef.current
    if (!group) return
    group.clearLayers()
    if (mode !== "sites" || !layers.leases) return
    const leaseIdx = selectedLeaseIndexes ?? []
    const highlightLeases =
      leaseIdx.length > 0 && leaseIdx.length < tradeArea.leases.length
    for (const pin of LEASE_PINS) {
      const lease = tradeArea.leases[pin.leaseIndex]
      if (!lease) continue
      const selected =
        highlightLeases && leaseIdx.includes(pin.leaseIndex)
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
  }, [layers.leases, mode, selectedLeaseIndexes, onSelectLease])

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
                onClick={(e) => {
                  e.preventDefault()
                  navigate(section.id)
                }}
              >
                <b>{section.number}</b>
                {open && <span>{section.label}</span>}
              </a>
              {open && section.children.length > 0 && (
                <div className="toc-sub">
                  {section.children.map((child) => (
                    <a
                      key={child.id}
                      href={`#${child.id}`}
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
              aria-label="Open analysis PDF"
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

type SitesFocus = "site" | "comparable"
type SiteChartTab = "1" | "2"
type HoodTab = "3" | "4" | "5"

const ALL_SITE_IDS = tradeArea.sites.map((s) => s.id)
const ALL_HOOD_NAMES = tradeArea.neighborhoods.map((n) => n.name)
const ALL_LEASE_INDEXES = tradeArea.leases.map((_, i) => i)
const DEFAULT_SITE_ID =
  tradeArea.sites.find((s) => s.id === "washington")?.id ?? ALL_SITE_IDS[0]

/** Offset from site markers so comps stay clickable (Wake and Late ≈ Lafayette). */
const LEASE_PINS: { leaseIndex: number; position: LatLngTuple }[] = [
  { leaseIndex: 0, position: [40.7281, -73.9929] },
  { leaseIndex: 1, position: [40.7296, -73.9932] },
  { leaseIndex: 2, position: [40.7322, -73.9915] },
]

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && a.every((id) => b.includes(id))
}

function selectionLabel(
  count: number,
  total: number,
  singular: string,
  allWord = "All",
) {
  if (count === 0) return "None selected"
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

const CHART_NOTES = {
  "1": [
    "Population and hotel rooms are for 5- and 10-minute walks (RadiusMapper). Walk-time areas are not drawn on the map.",
    "Employee counts use the 0.25- and 0.5-mile straight-line circles shown on the map.",
  ],
  "2": [
    "Ground-floor retail rental ranges are on hold until published sources are confirmed.",
  ],
  "3": [
    tradeArea.clickSourceLine,
    "Asking rents are N/A until received.",
    "Full comparison tables are in the analysis PDF.",
  ],
  "4": [
    tradeArea.clickSourceLine,
    "“$250K+” means at least one tract is at the Census top code ($250,001), so the true figure is a minimum.",
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
} as const

function NoteTip({
  notes,
  label,
}: {
  notes: readonly string[]
  label: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useMenuDismiss(open, () => setOpen(false))

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
        <div className="note-tip-popover" role="dialog" aria-label={`${label} notes`}>
          <ul>
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <a href="#sources" onClick={() => setOpen(false)}>
            Sources &amp; footnotes
          </a>
        </div>
      ) : null}
    </span>
  )
}

function ChartHeading({
  title,
  notes,
  extraNotes,
}: {
  title: string
  notes: readonly string[]
  extraNotes?: readonly string[]
}) {
  const allNotes = extraNotes?.length ? [...notes, ...extraNotes] : notes
  return (
    <div className="chart-heading">
      <h4>{title}</h4>
      <NoteTip notes={allNotes} label={title} />
    </div>
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
      ? (options.find((o) => o.id === selected[0])?.label ?? "1 selected")
      : selectionLabel(selected.length, allIds.length, singular)

  const toggle = (id: string) => {
    if (isAll) {
      onChange([id])
      return
    }
    if (selected.includes(id)) {
      const next = selected.filter((x) => x !== id)
      onChange(next.length ? next : [...allIds])
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
          <button
            type="button"
            className={isAll ? "active" : ""}
            onClick={() => onChange([...allIds])}
          >
            {allLabel}
          </button>
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
        ? "All sites"
        : selectedSiteIds.length === 1
          ? (tradeArea.sites.find((s) => s.id === selectedSiteIds[0])
              ?.address ?? "1 site")
          : selectionLabel(
              selectedSiteIds.length,
              tradeArea.sites.length,
              "site",
            )
      : compsAll
        ? "All comps"
        : selectedLeaseIndexes.length === 1
          ? `${selectedLeaseIndexes[0] + 1}. ${tradeArea.leases[selectedLeaseIndexes[0]]?.tenant}`
          : selectionLabel(
              selectedLeaseIndexes.length,
              tradeArea.leases.length,
              "comp",
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
      <span className="multi-select-label">Sites &amp; comps</span>
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
            <p className="menu-section">Sites</p>
            <button
              type="button"
              className={focus === "site" && sitesAll ? "active" : ""}
              onClick={() => {
                setFocus("site")
                setSelectedSiteIds([...ALL_SITE_IDS])
              }}
            >
              All sites
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
            <p className="menu-section">Lease comps</p>
            <button
              type="button"
              className={focus === "comparable" && compsAll ? "active" : ""}
              onClick={() => {
                setFocus("comparable")
                setSelectedLeaseIndexes([...ALL_LEASE_INDEXES])
              }}
            >
              All comps
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
  siteTab,
  setSiteTab,
  selectedSiteIds,
  setSelectedSiteIds,
  selectedLeaseIndexes,
}: {
  focus: SitesFocus
  siteTab: SiteChartTab
  setSiteTab: (t: SiteChartTab) => void
  selectedSiteIds: string[]
  setSelectedSiteIds: (ids: string[]) => void
  selectedLeaseIndexes: number[]
}) {
  const sites = tradeArea.sites.filter((s) => selectedSiteIds.includes(s.id))
  const leases = tradeArea.leases.filter((_, i) =>
    selectedLeaseIndexes.includes(i),
  )
  const singleSite = sites.length === 1 ? sites[0] : null
  const singleLease =
    leases.length === 1
      ? {
          lease: leases[0],
          index: tradeArea.leases.indexOf(leases[0]),
        }
      : null
  const chartData = singleSite
    ? [
        { label: "Pop 5-min", value: parseCount(singleSite.population5min) },
        { label: "Pop 10-min", value: parseCount(singleSite.population10min) },
        { label: "Emp 0.25 mi", value: parseCount(singleSite.employees025) },
        { label: "Emp 0.5 mi", value: parseCount(singleSite.employees05) },
      ]
    : []

  return (
    <aside className="detail-panel" id="sites-detail">
      <div className="detail-panel-head">
        <p className="eyebrow">
          {focus === "comparable" ? "Lease comps" : "Site corridors"}
        </p>
        <h3>
          {focus === "comparable"
            ? singleLease
              ? `${singleLease.index + 1}. ${singleLease.lease.tenant}`
              : selectionLabel(
                  selectedLeaseIndexes.length,
                  tradeArea.leases.length,
                  "comp",
                  "All comps",
                )
            : singleSite
              ? singleSite.address
              : selectionLabel(
                  selectedSiteIds.length,
                  tradeArea.sites.length,
                  "site",
                  "All sites",
                )}
        </h3>
        {focus === "comparable" && singleLease ? (
          <p className="chart-dek">{singleLease.lease.address}</p>
        ) : null}
      </div>

      {focus === "site" ? (
        <div className="panel-tabs" role="tablist" aria-label="Site charts">
          {(
            [
              ["1", "Demand drivers"],
              ["2", "Rental ranges"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={siteTab === id}
              className={siteTab === id ? "active" : ""}
              onClick={() => setSiteTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="detail-panel-body">
        {focus === "site" && siteTab === "1" ? (
          <div id="chart-1">
            <ChartHeading title="Demand drivers" notes={CHART_NOTES["1"]} />
            {singleSite ? (
              <>
                <dl className="stat-grid dense">
                  <div>
                    <dt>Population 5-min walk</dt>
                    <dd>{singleSite.population5min}</dd>
                  </div>
                  <div>
                    <dt>Population 10-min walk</dt>
                    <dd>{singleSite.population10min}</dd>
                  </div>
                  <div>
                    <dt>Employees 0.25-mile</dt>
                    <dd>{singleSite.employees025}</dd>
                  </div>
                  <div>
                    <dt>Employees 0.5-mile</dt>
                    <dd>{singleSite.employees05}</dd>
                  </div>
                  <div>
                    <dt>Student enrollment (0.5 mile)</dt>
                    <dd>{singleSite.students05}</dd>
                  </div>
                  <div>
                    <dt>Hotel rooms 5-min / 10-min</dt>
                    <dd>
                      {singleSite.hotels5min} / {singleSite.hotels10min}
                    </dd>
                  </div>
                </dl>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d5dee6" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="value" fill={BLUE} />
                  </BarChart>
                </ResponsiveContainer>
              </>
            ) : (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Site</th>
                      <th>Pop 5</th>
                      <th>Pop 10</th>
                      <th>Emp 0.25</th>
                      <th>Emp 0.5</th>
                      <th>Students</th>
                      <th>Hotels 5/10</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sites.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <button
                            type="button"
                            className="table-link"
                            onClick={() => setSelectedSiteIds([s.id])}
                          >
                            {s.address}
                          </button>
                          <span className="table-sub">{s.corridor}</span>
                        </td>
                        <td>{s.population5min}</td>
                        <td>{s.population10min}</td>
                        <td>{s.employees025}</td>
                        <td>{s.employees05}</td>
                        <td>{s.students05}</td>
                        <td>
                          {s.hotels5min} / {s.hotels10min}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        {focus === "site" && siteTab === "2" ? (
          <div id="chart-2" className="held">
            <ChartHeading title="Rental ranges" notes={CHART_NOTES["2"]} />
            <div className="held-box">Waiting on source confirmation</div>
          </div>
        ) : null}

        {focus === "comparable" ? (
          <div id="chart-6">
            <ChartHeading title="Lease comps" notes={CHART_NOTES["6"]} />
            {singleLease ? (
              <dl className="stat-grid dense">
                <div>
                  <dt>Tenant</dt>
                  <dd>{singleLease.lease.tenant}</dd>
                </div>
                <div>
                  <dt>Address</dt>
                  <dd>{singleLease.lease.address}</dd>
                </div>
                <div>
                  <dt>Square feet</dt>
                  <dd>{singleLease.lease.sf}</dd>
                </div>
                <div>
                  <dt>Asking rent</dt>
                  <dd>{singleLease.lease.askingRent}</dd>
                </div>
                <div>
                  <dt>Annual base rent</dt>
                  <dd>{singleLease.lease.annualBaseRent}</dd>
                </div>
                <div>
                  <dt>Date</dt>
                  <dd>{singleLease.lease.date}</dd>
                </div>
                <div className="span-2">
                  <dt>Deal notes</dt>
                  <dd>{singleLease.lease.notes}</dd>
                </div>
              </dl>
            ) : (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Tenant</th>
                      <th>SF</th>
                      <th>Asking</th>
                      <th>Annual</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tradeArea.leases.map((l, i) =>
                      selectedLeaseIndexes.includes(i) ? (
                        <tr key={l.tenant}>
                          <td>{i + 1}</td>
                          <td>
                            <span className="table-strong">{l.tenant}</span>
                            <span className="table-sub">{l.address}</span>
                          </td>
                          <td>{l.sf}</td>
                          <td>{l.askingRent}</td>
                          <td>{l.annualBaseRent}</td>
                          <td>{l.date}</td>
                        </tr>
                      ) : null,
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  )
}

function NeighborhoodDetailPanel({
  tab,
  setTab,
  selectedNames,
  setSelectedNames,
  hovered,
}: {
  tab: HoodTab
  setTab: (t: HoodTab) => void
  selectedNames: string[]
  setSelectedNames: (names: string[]) => void
  hovered: Neighborhood | null
}) {
  const hoods = tradeArea.neighborhoods.filter((n) =>
    selectedNames.includes(n.name),
  )
  const single = hoods.length === 1 ? hoods[0] : null
  const n = single ?? (hoods.length === 0 ? hovered : null)
  const ageData = n
    ? Object.entries(n.age).map(([band, value]) => ({
        band,
        value: parseCount(value),
      }))
    : []
  const incomeData = n
    ? [
        {
          label: "Median",
          value: n.medianIncomeSort ?? 0,
          display: n.medianHhIncome,
        },
        {
          label: "Average",
          value: parseCount(
            n.averageHhIncome.replace("K", "000").replace("+", ""),
          ),
          display: n.averageHhIncome,
        },
      ]
    : []
  const trafficData = n
    ? [
        {
          window: "8–9 AM",
          Weekday: parseCount(n.footTraffic.weekday["8-9 AM"]),
          Weekend: parseCount(n.footTraffic.weekend["8-9 AM"]),
        },
        {
          window: "12:30–1:30",
          Weekday: parseCount(n.footTraffic.weekday["12:30-1:30 PM"]),
          Weekend: parseCount(n.footTraffic.weekend["12:30-1:30 PM"]),
        },
        {
          window: "5–6 PM",
          Weekday: parseCount(n.footTraffic.weekday["5-6 PM"]),
          Weekend: parseCount(n.footTraffic.weekend["5-6 PM"]),
        },
      ]
    : []

  return (
    <aside className="detail-panel" id="neighborhoods-detail">
      <div className="detail-panel-head">
        <p className="eyebrow">Neighborhoods</p>
        <h3>
          {single
            ? single.name
            : selectionLabel(
                selectedNames.length,
                tradeArea.neighborhoods.length,
                "neighborhood",
                "All neighborhoods",
              )}
        </h3>
        {single ? <p className="chart-dek">{single.group}</p> : null}
        {!single && hovered && !selectedNames.includes(hovered.name) ? (
          <p className="chart-dek">Hovering {hovered.name} — click to focus</p>
        ) : null}
      </div>
      <div className="panel-tabs" role="tablist" aria-label="Neighborhood charts">
        {(
          [
            ["3", "Pop. & employees"],
            ["4", "Workforce"],
            ["5", "Foot traffic"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="detail-panel-body">
        {tab === "3" && (
          <div id="chart-3">
            <ChartHeading title="Pop. & employees" notes={CHART_NOTES["3"]} />
            {single && n ? (
              <>
                <dl className="stat-grid dense">
                  <div>
                    <dt>Population (estimate)</dt>
                    <dd>{n.population}</dd>
                  </div>
                  <div>
                    <dt>Employees</dt>
                    <dd>{n.employees}</dd>
                  </div>
                  <div>
                    <dt>W/ kids</dt>
                    <dd>{n.householdsWithKids}</dd>
                  </div>
                  <div>
                    <dt>HH &gt;$150K / &gt;$200K</dt>
                    <dd>
                      {n.hhOver150k} / {n.hhOver200k}
                    </dd>
                  </div>
                  <div>
                    <dt>Asking rent</dt>
                    <dd>{n.askingRent}</dd>
                  </div>
                </dl>
                <ResponsiveContainer width="100%" height={170}>
                  <BarChart data={ageData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d5dee6" />
                    <XAxis dataKey="band" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} unit="%" />
                    <Tooltip />
                    <Bar dataKey="value" name="Age mix % (estimate)" fill={BLUE} />
                  </BarChart>
                </ResponsiveContainer>
              </>
            ) : (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Neighborhood</th>
                      <th>Pop.</th>
                      <th>Employees</th>
                      <th>W/ kids</th>
                      <th>&gt;$150K</th>
                      <th>&gt;$200K</th>
                      <th>Asking</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hoods.map((hood) => (
                      <tr key={hood.name}>
                        <td>
                          <button
                            type="button"
                            className="table-link"
                            onClick={() => setSelectedNames([hood.name])}
                          >
                            {hood.name}
                          </button>
                          <span className="table-sub">{hood.group}</span>
                        </td>
                        <td>{hood.population}</td>
                        <td>{hood.employees}</td>
                        <td>{hood.householdsWithKids}</td>
                        <td>{hood.hhOver150k}</td>
                        <td>{hood.hhOver200k}</td>
                        <td>{hood.askingRent}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {tab === "4" && (
          <div id="chart-4">
            <ChartHeading title="Workforce" notes={CHART_NOTES["4"]} />
            {single && n ? (
              <>
                <dl className="stat-grid dense">
                  <div>
                    <dt>Median HH income (estimate)</dt>
                    <dd>{n.medianHhIncome}</dd>
                  </div>
                  <div>
                    <dt>Average HH income (estimate)</dt>
                    <dd>{n.averageHhIncome}</dd>
                  </div>
                  <div>
                    <dt>Bachelor’s or higher</dt>
                    <dd>{n.bachelorsOrHigher}</dd>
                  </div>
                </dl>
                <p className="sectors">
                  <b>Top sectors:</b> {n.topJobSectors}
                </p>
                <p className="sectors">
                  <b>Anchors:</b> {n.anchorCompanies}
                </p>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={incomeData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d5dee6" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => `$${Math.round(Number(v) / 1000)}K`}
                    />
                    <Tooltip
                      formatter={(_v, _n, item) => [
                        (item?.payload as { display?: string })?.display ?? _v,
                        "Income (estimate)",
                      ]}
                    />
                    <Bar dataKey="value" fill={BLUE} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="legend compact">
                  <p className="eyebrow">Map income shading</p>
                  <ul>
                    {INCOME_STOPS.map((stop) => (
                      <li key={stop.label}>
                        <i style={{ background: stop.color }} />
                        {stop.label}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            ) : (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Neighborhood</th>
                      <th>Median HH</th>
                      <th>Average HH</th>
                      <th>Bachelor’s+</th>
                      <th>Top sectors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hoods.map((hood) => (
                      <tr key={hood.name}>
                        <td>
                          <button
                            type="button"
                            className="table-link"
                            onClick={() => setSelectedNames([hood.name])}
                          >
                            {hood.name}
                          </button>
                        </td>
                        <td>{hood.medianHhIncome}</td>
                        <td>{hood.averageHhIncome}</td>
                        <td>{hood.bachelorsOrHigher}</td>
                        <td className="wrap-cell">{hood.topJobSectors}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {tab === "5" && (
          <div id="chart-5">
            <ChartHeading
              title="Foot traffic"
              notes={CHART_NOTES["5"]}
              extraNotes={
                single?.name === "Gramercy Park" ||
                selectedNames.includes("Gramercy Park")
                  ? [tradeArea.gramercyNote]
                  : undefined
              }
            />
            {single && n ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={trafficData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d5dee6" />
                  <XAxis dataKey="window" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Weekday" fill={NAVY} />
                  <Bar dataKey="Weekend" fill="#5f87a8" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Neighborhood</th>
                      <th>Wk 8–9</th>
                      <th>We 8–9</th>
                      <th>Wk lunch</th>
                      <th>We lunch</th>
                      <th>Wk 5–6</th>
                      <th>We 5–6</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hoods.map((hood) => (
                      <tr key={hood.name}>
                        <td>
                          <button
                            type="button"
                            className="table-link"
                            onClick={() => setSelectedNames([hood.name])}
                          >
                            {hood.name}
                          </button>
                        </td>
                        <td>{hood.footTraffic.weekday["8-9 AM"]}</td>
                        <td>{hood.footTraffic.weekend["8-9 AM"]}</td>
                        <td>{hood.footTraffic.weekday["12:30-1:30 PM"]}</td>
                        <td>{hood.footTraffic.weekend["12:30-1:30 PM"]}</td>
                        <td>{hood.footTraffic.weekday["5-6 PM"]}</td>
                        <td>{hood.footTraffic.weekend["5-6 PM"]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
        <h2>Sources &amp; footnotes</h2>
        <p>
          Endnotes from the {tradeArea.updated} Manhattan Trade Area Analysis
          master data. Numbers match the Word document. Approximate figures on
          the maps and charts are labeled estimate, modeled, or broker estimate.
        </p>
      </header>

      <div className="sources-layout">
        <article className="chart-panel">
          <h3>Reading notes</h3>
          <ul className="footnote-list">
            <li>
              Chart-specific caveats sit behind the ⓘ next to each panel
              header (demand drivers, workforce, foot traffic, lease comps,
              etc.).
            </li>
            <li>
              Approximate figures on the maps and charts are labeled estimate,
              modeled, or broker estimate.
            </li>
            <li>
              {tradeArea.credits.census} Base map: {tradeArea.credits.osm} ·
              CARTO light tiles.
            </li>
          </ul>
        </article>

        <article className="chart-panel">
          <h3>Numbered sources</h3>
          <p className="chart-dek">
            From the master data References sheet (same numbering as the
            analysis document).
          </p>
          <ol className="source-list">
            {tradeArea.references.map((ref) => (
              <li key={ref.no} id={`source-${ref.no}`}>
                <strong>[{ref.no}]</strong>
                <span>{linkifySource(ref.source)}</span>
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
      <div className="hero-inner">
        <img
          src={`${import.meta.env.BASE_URL}sir-logo.svg`}
          alt="Sotheby’s International Realty"
        />
        <p className="hero-kicker">CRE Matrix · Manhattan F&B Trade Area</p>
        <h1>CRE Matrix</h1>
        <p className="hero-dek">
          An interactive walk through Manhattan sites and neighborhoods — where
          the target neighborhoods sit, who lives and works there, and how the
          three site corridors compare. Every figure was manually picked and
          verified for this presentation from{" "}
          <a className="hero-inline-link" href="#sources">
            sources
          </a>
          .
        </p>
        <div className="hero-actions">
          <button type="button" className="hero-action" onClick={onExplore}>
            Explore sites &amp; corridors <span>↓</span>
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
          <span>26 neighborhoods · 3 sites</span>
          <span>Table 2 on hold</span>
        </div>
      </div>
    </section>
  )
}

export default function App() {
  const [tocOpen, setTocOpen] = useState(false)
  const [active, setActive] = useState("home")
  const [hovered, setHovered] = useState<Neighborhood | null>(null)
  const [selectedHoodNames, setSelectedHoodNames] = useState<string[]>([
    ...ALL_HOOD_NAMES,
  ])
  const [sitesFocus, setSitesFocus] = useState<SitesFocus>("site")
  const [siteTab, setSiteTab] = useState<SiteChartTab>("1")
  const [hoodTab, setHoodTab] = useState<HoodTab>("3")
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([
    DEFAULT_SITE_ID,
  ])
  const [selectedLeaseIndexes, setSelectedLeaseIndexes] = useState<number[]>([
    ...ALL_LEASE_INDEXES,
  ])
  const [siteLayers, setSiteLayers] = useState<Record<LayerKey, boolean>>({
    income: false,
    labels: false,
    radii: true,
    sites: true,
    leases: true,
  })
  const [hoodLayers, setHoodLayers] = useState<Record<LayerKey, boolean>>({
    income: true,
    labels: true,
    radii: false,
    sites: true,
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
  }
  const pickHood = (n: Neighborhood) => {
    setSelectedHoodNames([n.name])
  }

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
        setSelectedSiteIds([...ALL_SITE_IDS])
        setSiteTab(id.slice(-1) as SiteChartTab)
        scrollToId("sites-corridors")
      } else if (id === "chart-6") {
        setSitesFocus("comparable")
        setSelectedLeaseIndexes([...ALL_LEASE_INDEXES])
        scrollToId("sites-corridors")
      } else if (id === "chart-3" || id === "chart-4" || id === "chart-5") {
        setSelectedHoodNames([...ALL_HOOD_NAMES])
        setHoodTab(id.slice(-1) as HoodTab)
        scrollToId("neighborhoods")
      }
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [])

  return (
    <div className={`app ${tocOpen ? "toc-expanded" : ""}`}>
      <TableOfContents open={tocOpen} setOpen={setTocOpen} active={active} />
      <main>
        <HomeHero onExplore={() => scrollToId("sites-corridors")} />

        <section className="view-section" id="sites-corridors">
          <header className="view-header with-filter">
            <div className="view-header-copy">
              <h2>Sites &amp; corridors</h2>
              <p>
                Starts on 835 Washington St. Use the selector for sites or lease
                comps, or click markers on the map.
              </p>
            </div>
            <SitesCompsSelect
              focus={sitesFocus}
              setFocus={setSitesFocus}
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
                  ["radii", "0.25 / 0.5 mi circles"],
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
            <div className="map-legend-keys inline">
              <div className="site-key">
                <span className="key-label">Sites</span>
                {tradeArea.sites.map((s) => (
                  <span key={s.id}>
                    <span dangerouslySetInnerHTML={{ __html: markerHtml(s) }} />
                    {s.address}
                  </span>
                ))}
              </div>
              <span className="legend-sep" aria-hidden="true" />
              <div className="site-key comps-key">
                <span className="key-label">Lease comps</span>
                {tradeArea.leases.map((l, i) => (
                  <span key={l.tenant}>
                    <span className="lease-pin legend-pin">{i + 1}</span>
                    {l.tenant}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="map-stage split">
            <TradeMap
              mode="sites"
              layers={siteLayers}
              selectedNames={[]}
              selectedSiteIds={selectedSiteIds}
              selectedLeaseIndexes={selectedLeaseIndexes}
              onSelect={() => {}}
              onHover={() => {}}
              onSelectSite={pickSite}
              onSelectLease={pickLease}
            />
            <SitesDetailPanel
              focus={sitesFocus}
              siteTab={siteTab}
              setSiteTab={setSiteTab}
              selectedSiteIds={selectedSiteIds}
              setSelectedSiteIds={setSelectedSiteIds}
              selectedLeaseIndexes={selectedLeaseIndexes}
            />
          </div>
        </section>

        <section className="view-section" id="neighborhoods">
          <header className="view-header with-filter">
            <div className="view-header-copy">
              <h2>Neighborhoods</h2>
              <p>
                All 26 neighborhoods by default as a comparison table. Click the
                map or use the selector to focus one or several.
              </p>
            </div>
            <MultiSelect
              label="Neighborhoods"
              allIds={ALL_HOOD_NAMES}
              selected={selectedHoodNames}
              onChange={setSelectedHoodNames}
              allLabel="All neighborhoods"
              singular="neighborhood"
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
                  ["income", "Income shading"],
                  ["labels", "Neighborhood labels"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={hoodLayers[key]}
                    onChange={() =>
                      setHoodLayers((prev) => ({ ...prev, [key]: !prev[key] }))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <div
              className="map-legend-keys inline income-key"
              aria-label="Median household income shading"
            >
              <span className="key-label">Median HH income</span>
              {INCOME_STOPS.map((stop) => (
                <span key={stop.label} className="income-swatch">
                  <i style={{ background: stop.color }} />
                  {stop.label}
                </span>
              ))}
            </div>
          </div>

          <div className="map-stage split">
            <TradeMap
              mode="neighborhoods"
              layers={hoodLayers}
              selectedNames={selectedHoodNames}
              onSelect={pickHood}
              onHover={setHovered}
            />
            <NeighborhoodDetailPanel
              tab={hoodTab}
              setTab={setHoodTab}
              selectedNames={selectedHoodNames}
              setSelectedNames={setSelectedHoodNames}
              hovered={hovered}
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
                Sources &amp; footnotes
              </a>
              . Asking rents N/A pending update · Table 2 on hold.
            </p>
          </div>
        </footer>
      </main>
    </div>
  )
}
