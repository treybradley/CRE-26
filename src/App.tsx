import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  AnimatePresence,
  motion,
  useInView,
  useScroll,
  useTransform,
} from "framer-motion"
import {
  BarChart3,
  ChevronDown,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import * as L from "leaflet"
import { reportSections, type ReportTable } from "./data/reportData"

const BLUE = "#1F4E79"
const GOLD = "#b89a5e"
const TEAL = "#4e8d8a"
const REPORT_DATE = "31 October 2026"

const corridorCatchments = [
  {
    name: "University Place",
    address: "1 University Place",
    position: [40.73104, -73.99463] as [number, number],
    tracts: "50, 57, 61",
    rent: "$140–$185 / SF",
    driver: "Student, tech professional & transit density",
    proxy: "Dig · 691 Broadway",
    color: BLUE,
  },
  {
    name: "Lafayette Street",
    address: "372 Lafayette Street",
    position: [40.72751, -73.99358] as [number, number],
    tracts: "43, 49, 55",
    rent: "$175–$250 / SF",
    driver: "Elite NoHo DINK & luxury lifestyle demand",
    proxy: "Dig · 691 Broadway",
    color: TEAL,
  },
  {
    name: "Washington Street",
    address: "835 Washington Street",
    position: [40.74012, -74.0079] as [number, number],
    tracts: "73, 75, 79, 81",
    rent: "$220–$320 / SF",
    driver: "West Village wealth & destination leisure",
    proxy: "H. Valley · 569 Hudson Street",
    color: GOLD,
  },
]

function numberFrom(value?: string) {
  return Number((value ?? "").replace(/[^0-9.]/g, "")) || 0
}

function renderTourCitations(text: string) {
  return text.split(/(\[[1-6]\])/).map((part, index) => {
    const match = part.match(/^\[([1-6])\]$/)
    return match ? (
      <a
        className="inline-citation"
        href={`#tour-source-${match[1]}`}
        key={`${part}-${index}`}
        aria-label={`View 39 East 19th Street profile source ${match[1]}`}
      >
        {part}
      </a>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    )
  })
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

function SourceReference({
  sectionId,
  number = 1,
  target = "source-1",
}: {
  sectionId: string
  number?: number
  target?: string
}) {
  return (
    <sup className="source-reference">
      <a
        id={`source-ref-${number}-${sectionId}`}
        href={`#${target}`}
        aria-label={`View source footnote ${number}`}
      >
        {number}
      </a>
    </sup>
  )
}

function Reveal({
  children,
  className = "",
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

function ChartFrame({
  title,
  eyebrow,
  children,
}: {
  title: string
  eyebrow: string
  children: (size: { width: number height: number }) => ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const visible = useInView(ref, { once: true, margin: "-80px" })

  useEffect(() => {
    const measure = () => {
      if (!chartRef.current) return
      const bounds = chartRef.current.getBoundingClientRect()
      const next = {
        width: Math.max(0, Math.floor(bounds.width)),
        height: Math.max(0, Math.floor(bounds.height)),
      }
      setSize((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next,
      )
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [])

  return (
    <div ref={ref} className="chart-frame">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
      </div>
      <div ref={chartRef} className="chart-area">
        {visible && size.width > 0 && size.height > 0 ? children(size) : null}
      </div>
    </div>
  )
}

function GlassTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ name?: string value?: number color?: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => (
        <span key={item.name} style={{ color: item.color }}>
          {item.name}: {item.value}
          {item.name?.toLowerCase().includes("income") ? "K" : ""}
        </span>
      ))}
    </div>
  )
}

function WrappedXAxisTick({
  x = 0,
  y = 0,
  payload,
}: {
  x?: number
  y?: number
  payload?: { value?: string }
}) {
  const words = (payload?.value ?? "").split(/\s+/)
  const lines: string[] = []
  words.forEach((word) => {
    const current = lines.at(-1)
    if (!current || (current.length + word.length > 14 && lines.length < 3)) {
      lines.push(word)
    } else {
      lines[lines.length - 1] = `${current} ${word}`
    }
  })
  return (
    <text x={x} y={y + 10} textAnchor="middle" fill="#647586" fontSize={10}>
      {lines.map((line, index) => (
        <tspan x={x} dy={index === 0 ? 0 : 12} key={line}>
          {line}
        </tspan>
      ))}
    </text>
  )
}

function IncomeChart({ table }: { table: ReportTable }) {
  const data = table.rows
    .slice(1)
    .filter((row) => row.length >= 5)
    .map((row) => ({
      name: (row[0] ?? "Unspecified").replace(" District", ""),
      "Average income": numberFrom(row[3]),
      "Median income": numberFrom(row[4]),
    }))
  return (
    <ChartFrame
      eyebrow={`${table.title} · Chart view`}
      title="Affluence by micro-market"
    >
      {({ width, height }) => (
        <BarChart
          width={width}
          height={height}
          data={data}
          margin={{ top: 12, right: 8, left: -12, bottom: 30 }}
        >
          <CartesianGrid stroke="#d7e0e8" vertical={false} />
          <XAxis
            dataKey="name"
            interval={0}
            height={58}
            tick={<WrappedXAxisTick />}
          />
          <YAxis
            tickFormatter={(value) => `$${value}K`}
            tick={{ fontSize: 11 }}
          />
          <Tooltip
            content={<GlassTooltip />}
            cursor={{ fill: "rgba(31,78,121,.06)" }}
          />
          <Legend verticalAlign="top" align="right" />
          <Bar
            dataKey="Average income"
            fill={BLUE}
            radius={[5, 5, 0, 0]}
            animationDuration={900}
          />
          <Bar
            dataKey="Median income"
            fill={TEAL}
            radius={[5, 5, 0, 0]}
            animationDuration={1100}
          />
        </BarChart>
      )}
    </ChartFrame>
  )
}

function LeaseChart({ table }: { table: ReportTable }) {
  const headerIndex = table.rows.findIndex((row) =>
    row.includes("TENANT BRAND / CONCEPT"),
  )
  const data = table.rows
    .slice(headerIndex + 1)
    .filter((row) => row[0] !== "TENANT BRAND / CONCEPT")
    .map((row) => ({
      name: row[0],
      "Executed rent": numberFrom(row[3]),
      squareFeet: numberFrom(row[2]),
    }))
  return (
    <ChartFrame eyebrow="Executed comparables" title="Base rent by F&B tenant">
      {({ width, height }) => (
        <BarChart
          width={width}
          height={height}
          data={data}
          layout="vertical"
          margin={{ left: 14, right: 18 }}
        >
          <CartesianGrid stroke="#d7e0e8" horizontal={false} />
          <XAxis type="number" tickFormatter={(v) => `$${v}`} />
          <YAxis
            type="category"
            dataKey="name"
            width={104}
            tick={{ fontSize: 12 }}
          />
          <Tooltip
            formatter={(value, name, item) => [
              `$${value} / SF · ${item.payload.squareFeet.toLocaleString()} SF`,
              name,
            ]}
            contentStyle={{
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,.5)",
            }}
            cursor={{ fill: "rgba(31,78,121,.06)" }}
          />
          <Bar
            dataKey="Executed rent"
            fill={BLUE}
            radius={[0, 6, 6, 0]}
            animationDuration={1000}
          >
            {data.map((_, index) => (
              <Cell
                key={index}
                fill={[BLUE, TEAL, GOLD, "#6e7e90"][index % 4]}
              />
            ))}
          </Bar>
        </BarChart>
      )}
    </ChartFrame>
  )
}

function Heatmap({ table }: { table: ReportTable }) {
  const [view, setView] = useState<"heatmap" | "table">("heatmap")
  const headers = table.rows[0]
  const rows = table.rows.slice(1)
  const values = rows.flatMap((row) => row.slice(2).map(numberFrom))
  const min = Math.min(...values)
  const max = Math.max(...values)
  return (
    <div
      className="heatmap-card"
      id={slug(table.id)}
      aria-label={`${table.title} heatmap`}
    >
      <div className="heatmap-heading">
        <div>
          <p className="eyebrow">
            {table.title} · {view === "heatmap" ? "Heatmap" : "Plain"} view
          </p>
          <h3>Age, household & wealth intensity</h3>
          <p className="heatmap-explainer">
            Toggle between a visual intensity comparison and the exact source
            values.
          </p>
        </div>
        <div className="matrix-controls">
          {(["heatmap", "table"] as const).map((option) => (
            <button
              className={view === option ? "active" : ""}
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
            >
              {option === "heatmap" ? "Heatmap" : "Plain table"}
            </button>
          ))}
        </div>
      </div>
      {view === "heatmap" ? (
        <>
          <div className="heatmap-scale">
            <span>
              Lower <i /> Higher
            </span>
          </div>
          <div className="heatmap-scroll" tabIndex={0}>
            <div
              className="heatmap"
              style={{
                gridTemplateColumns: `minmax(170px, 1.5fr) repeat(${headers.length - 2}, minmax(78px, 1fr))`,
              }}
            >
              <div className="heat-label heat-head">Micro-market</div>
              {headers.slice(2).map((header) => (
                <div key={header} className="heat-cell heat-head">
                  {header}
                </div>
              ))}
              {rows.map((row) => (
                <div className="heat-row" key={`${row[0]}-${row[1]}`}>
                  <div className="heat-label">
                    <strong>{row[0]}</strong>
                    <small>Tracts {row[1]}</small>
                  </div>
                  {row.slice(2).map((value, index) => {
                    const intensity =
                      (numberFrom(value) - min) / (max - min || 1)
                    return (
                      <div
                        key={`${row[0]}-${headers[index + 2]}`}
                        className="heat-cell"
                        title={`${row[0]} · ${headers[index + 2]} · ${value}`}
                        style={{
                          backgroundColor: `color-mix(in srgb, ${BLUE} ${18 + intensity * 76}%, white)`,
                          color: intensity > 0.55 ? "white" : "#173047",
                        }}
                        tabIndex={0}
                        aria-label={`${row[0]}, ${headers[index + 2]}, ${value}`}
                      >
                        {value}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="compact-matrix">
          <DataTable table={table} />
        </div>
      )}
    </div>
  )
}

function TradeAreaMap() {
  const [radiusMode, setRadiusMode] = useState<"both" | "5" | "10">("both")
  const mapElementRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const catchmentLayersRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) return

    const map = L.map(mapElementRef.current, {
      center: [40.7328, -74.0007],
      zoom: 14,
      scrollWheelZoom: false,
      zoomControl: true,
    })
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)

    mapRef.current = map
    catchmentLayersRef.current = L.layerGroup().addTo(map)

    return () => {
      map.remove()
      mapRef.current = null
      catchmentLayersRef.current = null
    }
  }, [])

  useEffect(() => {
    const layers = catchmentLayersRef.current
    if (!layers) return
    layers.clearLayers()

    corridorCatchments.forEach((corridor) => {
      if (radiusMode === "both" || radiusMode === "10") {
        L.circle(corridor.position, {
          radius: 800,
          color: corridor.color,
          fillColor: corridor.color,
          fillOpacity: 0.08,
          weight: 1.5,
          dashArray: "6 6",
        }).addTo(layers)
      }
      if (radiusMode === "both" || radiusMode === "5") {
        L.circle(corridor.position, {
          radius: 400,
          color: corridor.color,
          fillColor: corridor.color,
          fillOpacity: 0.18,
          weight: 2,
        }).addTo(layers)
      }
      const popup = document.createElement("div")
      popup.className = "map-popup"
      const heading = document.createElement("strong")
      heading.textContent = corridor.name
      popup.append(heading)
      ;[
        corridor.address,
        `Tracts ${corridor.tracts}`,
        corridor.rent,
        corridor.driver,
      ].forEach((text) => {
        const line = document.createElement("span")
        line.textContent = text
        popup.append(line)
      })
      L.circleMarker(corridor.position, {
        radius: 7,
        color: "white",
        fillColor: corridor.color,
        fillOpacity: 1,
        weight: 2,
      })
        .bindPopup(popup)
        .addTo(layers)
    })
  }, [radiusMode])

  return (
    <Reveal>
      <section className="map-card" aria-labelledby="trade-area-map-title">
        <div className="map-heading">
          <div>
            <p className="eyebrow">Illustrative walking catchments</p>
            <h3 id="trade-area-map-title">True trade area corridor map</h3>
            <p>
              Compare representative 5- and 10-minute walk radii across the
              three target corridors.
            </p>
          </div>
          <div className="map-toggle" aria-label="Visible walking radii">
            {(["both", "5", "10"] as const).map((mode) => (
              <button
                className={radiusMode === mode ? "active" : ""}
                key={mode}
                onClick={() => setRadiusMode(mode)}
                type="button"
              >
                {mode === "both" ? "Both" : `${mode} min`}
              </button>
            ))}
          </div>
        </div>
        <div className="map-layout">
          <div className="map-shell">
            <div
              ref={mapElementRef}
              className="leaflet-container"
              role="application"
              aria-label="Map of downtown Manhattan trade area catchments"
            />
          </div>
          <div className="map-corridors">
            {corridorCatchments.map((corridor) => (
              <article key={corridor.name}>
                <i style={{ background: corridor.color }} />
                <div>
                  <h4>{corridor.name}</h4>
                  <p className="corridor-address">{corridor.address}</p>
                  <p>{corridor.driver}</p>
                  <dl>
                    <div>
                      <dt>Tracts</dt>
                      <dd>{corridor.tracts}</dd>
                    </div>
                    <div>
                      <dt>Rent</dt>
                      <dd>{corridor.rent}</dd>
                    </div>
                    <div>
                      <dt>Proxy</dt>
                      <dd>{corridor.proxy}</dd>
                    </div>
                  </dl>
                </div>
              </article>
            ))}
          </div>
        </div>
        <p className="map-note">
          Indicative circles use approximately 400m and 800m straight-line radii
          as presentation proxies for 5- and 10-minute walks. They are not
          street-network isochrones.
        </p>
      </section>
    </Reveal>
  )
}

function SingleSiteMap({
  address,
  position,
}: {
  address: string
  position: [number, number]
}) {
  const [radiusMode, setRadiusMode] = useState<"both" | "5" | "10">("both")
  const mapElementRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layersRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) return
    const map = L.map(mapElementRef.current, {
      center: position,
      zoom: 15,
      scrollWheelZoom: false,
    })
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)
    mapRef.current = map
    layersRef.current = L.layerGroup().addTo(map)
    return () => {
      map.remove()
      mapRef.current = null
      layersRef.current = null
    }
  }, [position])

  useEffect(() => {
    const layers = layersRef.current
    if (!layers) return
    layers.clearLayers()
    if (radiusMode === "both" || radiusMode === "10") {
      L.circle(position, {
        radius: 834,
        color: GOLD,
        fillColor: GOLD,
        fillOpacity: 0.09,
        weight: 1.5,
        dashArray: "6 6",
      }).addTo(layers)
    }
    if (radiusMode === "both" || radiusMode === "5") {
      L.circle(position, {
        radius: 417,
        color: BLUE,
        fillColor: BLUE,
        fillOpacity: 0.18,
        weight: 2,
      }).addTo(layers)
    }
    L.circleMarker(position, {
      radius: 8,
      color: "white",
      fillColor: BLUE,
      fillOpacity: 1,
      weight: 2,
    })
      .bindPopup(`<strong>${address}</strong><br/>Tour site nucleus`)
      .addTo(layers)
  }, [address, position, radiusMode])

  return (
    <div className="site-map">
      <div className="map-heading">
        <div>
          <p className="eyebrow">Illustrative walking catchments</p>
          <h3>39 East 19th Street trade area</h3>
          <p>
            Five-minute radius follows the source profile’s approximate
            417-meter model; the 10-minute view doubles that distance.
          </p>
        </div>
        <div className="map-toggle" aria-label="Visible tour-site radii">
          {(["both", "5", "10"] as const).map((mode) => (
            <button
              className={radiusMode === mode ? "active" : ""}
              key={mode}
              onClick={() => setRadiusMode(mode)}
              type="button"
            >
              {mode === "both" ? "Both" : `${mode} min`}
            </button>
          ))}
        </div>
      </div>
      <div className="map-shell">
        <div
          ref={mapElementRef}
          className="leaflet-container"
          role="application"
          aria-label="Map of 39 East 19th Street walking catchments"
        />
      </div>
      <p className="map-note">
        The overlays are illustrative circles, not sidewalk-constrained
        isochrones. The attached profile’s five-minute analysis uses a
        street-network model.
      </p>
    </div>
  )
}

function PhaseTwoSection() {
  const deliverables = [
    {
      title: "Continuous Pedestrian Street-Grid Walk Shed Generation",
      text: "Converting standard circular radii into precise sidewalk-constrained pedestrian walk sheds tracking real physical barriers and transit entryways around 1-3 University Place, 372 Lafayette, and 835 Washington",
    },
    {
      title: "Mobile Device Geofencing & Daypart Traffic Heatmaps",
      text: "Overlaying active device velocity gradients across the 5- and 10-minute walk polygons to isolate morning espresso spikes, peak lunch rushes, and evening grocery replenishment windows",
    },
    {
      title: "Psychographic Profiling & Household Expenditure Injection",
      text: "Injecting Esri Tapestry lifestyle segments paired with granular localized consumer expenditure metrics mapping specific dollars spent on groceries versus dining away from home",
    },
  ]
  return (
    <section className="report-section phase-two" id="phase-two">
      <header className="section-header">
        <span className="section-number">II</span>
        <div>
          <p className="eyebrow">Phase II</p>
          <h2>ADVANCED LOCATION INTELLIGENCE &amp; PRODUCTION SCHEDULE</h2>
        </div>
      </header>
      <div className="phase-grid">
        {deliverables.map((item, index) => (
          <article key={item.title}>
            <span>0{index + 1}</span>
            <h3>{item.title}</h3>
            <p>
              <strong>The Deliverable:</strong> {item.text}
            </p>
            <small>Estimated Completion Timeline: —</small>
          </article>
        ))}
      </div>
    </section>
  )
}

function TourSiteEvaluation() {
  const metrics = [
    ["Total office inventory [1]", "Approx. 6.9 million SF"],
    [
      "Properties containing retail space [1]",
      "222 tax lots — Property count; individual tenant count not verified.",
    ],
    ["Retail-trade employment [2]", "Approx. 2,600 jobs"],
    ["Accommodation / food-service employment [2]", "Approx. 2,900 jobs"],
    ["Total employment - all industries [2]", "Approx. 31,200 jobs"],
    ["Average weekday storefront foot traffic", "Not verified"],
    [
      "Nearby weekday pedestrian benchmark [3]",
      "11,539 passages in five observed hours — East 14th St., Fifth Ave. to University Pl.; May 2026.",
    ],
    [
      "Hotel properties identified [4]",
      "3 hotels | 462 rooms total — Includes Gramercy Park Hotel under renovation.",
    ],
    ["Residential population [5]", "Approx. 5,800 residents"],
    ["Housing units [1]", "Approx. 4,400 units"],
    [
      "Estimated median household income [5]",
      "$200,000+ annually — Estimated median falls in the open-ended $200,000+ bracket.",
    ],
  ]
  return (
    <section className="report-section tour-section" id="tour-sites">
      <header className="section-header">
        <span className="section-number">T</span>
        <div>
          <p className="eyebrow">Ongoing site diligence</p>
          <h2>Tour Site Evaluation</h2>
          <p>
            Site-specific observations, property materials and trade-area
            profiles added as tours are completed.
          </p>
        </div>
      </header>
      <article className="tour-card" id="tour-site-01">
        <header className="tour-card-header">
          <div>
            <p className="eyebrow">October 26, 2026 · Tour site 01</p>
            <h3>39 East 19th Street</h3>
            <p>Between Broadway / Park Avenue So</p>
          </div>
          <a
            href={`${import.meta.env.BASE_URL}39-east-19th-street-profile.pdf`}
            target="_blank"
            rel="noreferrer"
          >
            View original profile &amp; flyer ↗
          </a>
        </header>

        <div className="tour-subhead">
          <p className="eyebrow">Approximate Five-Minute Walk | Area Profile</p>
          <strong>PRELIMINARY ESTIMATES | Prepared October 25, 2026</strong>
        </div>
        <div className="site-metrics">
          {metrics.map(([label, value]) => (
            <div key={label}>
              <dt>{renderTourCitations(label)}</dt>
              <dd>{renderTourCitations(value)}</dd>
            </div>
          ))}
        </div>
        <div className="tour-notes">
          <p>
            Foot-traffic benchmark: 2,370 passages, 7-9 a.m.; 9,169, 4-7 p.m.
            Both sidewalks, sampled weekday. The counter is outside the modeled
            area; this is neither a daily average nor a storefront count.
          </p>
          <p>
            Operating: W New York - Union Square, 256 rooms; The Inn at Irving
            Place, 9 rooms. Under renovation: Gramercy Park Hotel, 197 rooms.
            Operating inventory: 265 rooms.
          </p>
          <p>
            <strong>Method &amp; data dates:</strong>{" "}
            {renderTourCitations(
              "Street-network model [6], ~417 meters at 3.1 mph; no signal delays. Properties use representative lot points; employment uses Census-block representative points. Employment is 2023 reported jobs, not unique people or daily attendance. Population and income use 2020-2024 ACS block groups, weighted by each group's share of residential units inside the area. Totals are approximate; boundary properties and hotel inventory require confirmation.",
            )}
          </p>
        </div>
        <div className="tour-profile-sources">
          <h4>SOURCES (CLICKABLE IN DIGITAL COPY)</h4>
          <p>39 East 19th Street Profile Sources</p>
          <ol>
            <li id="tour-source-1">
              <a
                href="https://data.cityofnewyork.us/resource/64uk-42ks.json"
                target="_blank"
                rel="noreferrer"
              >
                [1] NYC PLUTO 26v2: office / retail area and housing units.
              </a>
            </li>
            <li id="tour-source-2">
              <a
                href="https://lehd.ces.census.gov/data/"
                target="_blank"
                rel="noreferrer"
              >
                [2] U.S. Census LODES 2023: workplace employment by industry.
              </a>
            </li>
            <li id="tour-source-3">
              <a
                href="https://data.cityofnewyork.us/Transportation/Bi-Annual-Pedestrian-Counts/cqsj-cfgu/about_data"
                target="_blank"
                rel="noreferrer"
              >
                [3] NYC DOT Bi-Annual Pedestrian Counts: location 41.
              </a>
            </li>
            <li id="tour-source-4">
              <a
                href="https://www.mcrhotels.com/hotels/gramercy-park-hotel/"
                target="_blank"
                rel="noreferrer"
              >
                [4] Marriott / W announcement; Inn at Irving Place; MCR /
                Gramercy Park Hotel.
              </a>
            </li>
            <li id="tour-source-5">
              <a
                href="https://www.census.gov/data/developers/data-sets/acs-5year.html"
                target="_blank"
                rel="noreferrer"
              >
                [5] ACS 2020-2024, B01003 &amp; B19001; retrieved via Census
                Reporter.
              </a>
            </li>
            <li id="tour-source-6">
              <a
                href="https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/ArcGIS/rest/services/LION/FeatureServer/0"
                target="_blank"
                rel="noreferrer"
              >
                [6] NYC LION street network.
              </a>
            </li>
          </ol>
        </div>

        <SingleSiteMap
          address="39 East 19th Street"
          position={[40.73812, -73.98945]}
        />

        <div className="property-facts">
          <div>
            <strong>Approx 2,200 Gross Sq Ft Ground</strong>
          </div>
          <div>
            <strong>Approx 2,250 Gross Sq Ft Basement</strong>
          </div>
          <div>
            <strong>Now Considering Lease or Purchase</strong>
          </div>
          <div>
            <strong>Low Maintenance ~$7,200 / Mo</strong>
          </div>
          <div>
            <strong>2nd Generation Restaurant</strong>
          </div>
          <div>
            <strong>$32K / month</strong>
          </div>
        </div>
        <div className="property-copy">
          <h4>Flatiron / Union Square Restaurant Property</h4>
          <p>
            Perfect situation for an end user restaurant to buy their own
            property to occupy. This coop is a 2nd generation restaurant with
            approximately 2,200 gross square feet on the ground floor and 2,250
            gross square feet in the basement, (sf as listed in the Coop
            offering plan). Previously Bocca Restaurant for 18 years but now
            vacant and ready for immediate possession. Previous tenant had a
            full liquor license, a hood, venting, gas line and some equipment
            still remaining in the premises including stoves, walk-ins, etc.
            There has been about $3m in assessments in the last 3 years that
            have been paid in full for major capital improvements in the
            building with large reserve fund remaining which reduces the
            likelihood of assessment costs in the future for a new owner.
            Preference to sell but considering lease offers as well.
          </p>
          <h4>Location Highlights</h4>
          <p>
            Next door to the renowned Craft Restaurant by Tom Colicchio and
            across from Jean George’s ABC Cocina, this opportunity is located in
            the middle of where Union Square. Flatiron &amp; Gramercy Park meet.
            Very strong mix of food &amp; beverage operators in the area as well
            as major office/residential tenants. Close to the 6 train at 23rd
            and Park and R,W at 23rd &amp; Broadway and 4,5,6,N,R,W,Q,L trains
            at Union Square. Neighbors Include: Craft Restaurant Vallata
            Starbucks ABC Cocina Chase Bank Casa la Femme abcV ABC Carpet &amp;
            Home Laser Away Flatiron and more.
          </p>
        </div>
        <div className="tour-contact">
          <strong>For More Information Contact:</strong>
          <span>Jeffrey Angel</span>
          <span>212-719-7017</span>
          <span>Jeffrey.angel@resnewyork.com</span>
        </div>
        <p className="tour-disclaimer">
          All information contained herein, including but not limited to square
          footage, zoning, lease details, capital or leasehold improvements and
          any or all other information has been provided by sources we deem
          reliable but should not be relied upon in any way and should be
          independently verified prior to entering into any form of legally
          binding agreement to purchase, lease or otherwise procure the premises
          or situation presented herein. No expressed or implied warranties are
          made by RES Commercial Corp nor the Owner of the property as to the
          accuracy of any information and should be independently verified prior
          to executing any form of binding contract or agreement. Information is
          subject to change or withdrawal without notice and may contain errors
          and/or omissions.
        </p>
      </article>
    </section>
  )
}

const briefSectionPattern =
  /(?=Target Core Boundaries:|Neighborhood Asset Segments:|Income Viability:|The Weekday Engine \(|The Weekend Engine \(|The Night & Evening Engine \(|Peak Earners \(|Luxury Families \(|Affluent Singles\/DINKs \(|University Place Corridor \(|Lafayette Street Corridor \(|Washington Street Corridor \(|The Rental Environment \(|The Space Configuration \(|The Executed Lease Environment \(|The Transacted Lease Environment \(|The Structural Infrastructure Deal Terms \()/

function parseBrief(text: string) {
  const clean = text
    .replace(/^📝/, "")
    .replace(/^UNDERWRITING BRIEF:\s*/i, "")
    .trim()
  const firstSection = clean.search(briefSectionPattern)
  const title =
    firstSection > 0
      ? clean.slice(0, firstSection).trim()
      : "Underwriting Brief"
  const body = firstSection > 0 ? clean.slice(firstSection) : clean
  return {
    title,
    sections: body
      .split(briefSectionPattern)
      .map((section) => section.trim())
      .filter(Boolean)
      .map((section) => {
        const boundary = section.search(
          /(?:The Drivers:|Leader:|Target Core Boundaries:|Neighborhood Asset Segments:|Income Viability:|The Operational Impact:|Operational Impact:)/,
        )
        if (boundary <= 0) {
          const colon = section.indexOf(":")
          return colon > 0
            ? {
                heading: section.slice(0, colon),
                body: section.slice(colon + 1).trim(),
              }
            : { heading: "Key finding", body: section }
        }
        return {
          heading: section.slice(0, boundary).trim(),
          body: section.slice(boundary).trim(),
        }
      }),
  }
}

function BriefBody({ text }: { text: string }) {
  const parts = text.split(
    /(The Drivers:|Spending Behavior:|Leader:|Wealth Baseline:|Ideal Format:|The Operational Impact:|Operational Impact:)/,
  )
  return (
    <p>
      {parts.map((part, index) =>
        part.endsWith(":") ? (
          <strong key={`${part}-${index}`}>{part}</strong>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </p>
  )
}

function UnderwritingBrief({ text }: { text: string }) {
  const brief = parseBrief(text)
  return (
    <aside className="brief">
      <header className="brief-header">
        <span className="brief-mark">
          <BarChart3 size={18} />
        </span>
        <div>
          <p className="eyebrow">Decision brief</p>
          <h3>{brief.title}</h3>
        </div>
      </header>
      <div className="brief-grid">
        {brief.sections.map((section, index) => (
          <article key={`${section.heading}-${index}`}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <h4>{section.heading}</h4>
            <BriefBody text={section.body} />
          </article>
        ))}
      </div>
    </aside>
  )
}

function DataTable({ table }: { table: ReportTable }) {
  const nonEmptyRows = table.rows.filter((row) =>
    row.some((cell) => cell.trim()),
  )
  if (nonEmptyRows.length === 1 && nonEmptyRows[0].length === 1) {
    return nonEmptyRows[0][0].includes("UNDERWRITING BRIEF") ? (
      <UnderwritingBrief text={nonEmptyRows[0][0]} />
    ) : (
      <aside className="exclusion">
        <strong>Explicit exclusions</strong>
        <p>{nonEmptyRows[0][0]}</p>
      </aside>
    )
  }
  const [header, ...rawRows] = nonEmptyRows
  const briefRows = rawRows.filter(
    (row) => row.length === 1 && row[0].includes("UNDERWRITING BRIEF"),
  )
  const noteRows = rawRows.filter(
    (row) => row.length === 1 && !row[0].includes("UNDERWRITING BRIEF"),
  )
  const grouped =
    header[1]?.includes("CENSUS TRACT ISOLATION / BOUNDARY") ?? false
  const rows = rawRows
    .filter(
      (row) =>
        row.length > 1 && !header.every((cell, index) => row[index] === cell),
    )
    .map((row) => {
      if (!grouped || !row[0]) return row
      const words = row[0].replace(/\s+/g, " ").trim().split(" ")
      for (let size = 1; size <= Math.floor(words.length / 2); size += 1) {
        if (words.length % size !== 0) continue
        const label = words.slice(0, size).join(" ")
        const repeated = Array.from(
          { length: words.length / size },
          (_, index) => words.slice(index * size, (index + 1) * size).join(" "),
        )
        if (repeated.every((part) => part === label)) {
          return [label, ...row.slice(1)]
        }
      }
      return row
    })
  const rowSpans = new Map<number, number>()
  if (grouped) {
    rows.forEach((row, index) => {
      if (!row[0]) return
      let span = 1
      while (index + span < rows.length && !rows[index + span][0]) span += 1
      rowSpans.set(index, span)
    })
  }
  return (
    <div className="table-stack">
      <div className="table-scroll" tabIndex={0}>
        <table>
          <thead>
            <tr>
              {header.map((cell, i) => (
                <th key={`${cell}-${i}`}>{cell}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {header.map((_, c) => {
                  if (grouped && c === 0 && !row[0]) return null
                  return (
                    <td
                      key={c}
                      rowSpan={grouped && c === 0 ? rowSpans.get(r) : undefined}
                    >
                      {row[c] || "—"}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          {noteRows.length > 0 && (
            <tfoot>
              {noteRows.map((row, index) => (
                <tr key={index}>
                  <td colSpan={header.length}>{row[0]}</td>
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>
      {briefRows.map((row, index) => (
        <UnderwritingBrief text={row[0]} key={index} />
      ))}
    </div>
  )
}

function ReportBlock({ table }: { table: ReportTable }) {
  const anchor = slug(table.id)
  return (
    <Reveal>
      <details className="report-block" id={anchor} open>
        <summary>
          <span>
            {table.title}
            {table.title.startsWith("4.2 Ground-Floor") && (
              <SourceReference
                sectionId="retail-rental-ranges"
                number={2}
                target="market-dynamics-sources"
              />
            )}
          </span>
          <ChevronDown size={18} />
        </summary>
        <div className="report-content">
          <DataTable table={table} />
        </div>
      </details>
    </Reveal>
  )
}

function TableOfContents({
  open,
  setOpen,
  active,
  onNavigate,
}: {
  open: boolean
  setOpen: (value: boolean) => void
  active: string
  onNavigate: (sectionId: string) => void
}) {
  const navigate = (sectionId: string) => {
    onNavigate(sectionId)
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
          {open && <span>Report contents</span>}
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
        <nav aria-label="Report sections">
          {open && <p className="toc-phase-label">Phase I · Market analysis</p>}
          {reportSections.map((section) => (
            <div className="toc-group" key={section.id}>
              <a
                className={active === section.id ? "active" : ""}
                href={`#${section.id}`}
                onClick={() => navigate(section.id)}
              >
                <b>{section.number}</b>
                {open && <span>{section.title}</span>}
              </a>
              {open && (
                <div className="toc-sub">
                  {section.tables
                    .filter((table) =>
                      /^\d\.\d(?:\.[A-Z])?[:\s]/.test(table.title),
                    )
                    .map((table) => (
                      <a
                        href={`#${slug(table.id)}`}
                        key={table.id}
                        onClick={() => navigate(section.id)}
                      >
                        {table.title}
                      </a>
                    ))}
                </div>
              )}
            </div>
          ))}
          {open && <p className="toc-phase-label">Site diligence</p>}
          <div className="toc-group">
            <a
              className={active === "tour-sites" ? "active" : ""}
              href="#tour-sites"
              onClick={() => navigate("tour-sites")}
            >
              <b>T</b>
              {open && <span>Tour Site Evaluation</span>}
            </a>
            {open && (
              <div className="toc-sub">
                <a href="#tour-site-01" onClick={() => navigate("tour-sites")}>
                  Tour Site 01 · 39 East 19th Street
                </a>
              </div>
            )}
          </div>
          {open && <p className="toc-phase-label">Source References</p>}
          <div className="toc-group">
            <a
              className={active === "sources" ? "active" : ""}
              href="#sources"
              onClick={() => navigate("sources")}
            >
              <b>S</b>
              {open && <span>Sources &amp; Footnotes</span>}
            </a>
          </div>
        </nav>
      </motion.aside>
    </>
  )
}

export default function App() {
  const [tocOpen, setTocOpen] = useState(true)
  const [active, setActive] = useState("midtown")
  const navigationTargetRef = useRef<string | null>(null)
  const heroRef = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  })
  const gridY = useTransform(scrollYProgress, [0, 1], [0, 120])

  useEffect(() => {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>(".report-section"),
    )
    let frame = 0
    const updateActiveSection = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (navigationTargetRef.current) {
          setActive(navigationTargetRef.current)
          return
        }
        const probe = window.innerHeight * 0.35
        const current = sections.find((section) => {
          const bounds = section.getBoundingClientRect()
          return bounds.top <= probe && bounds.bottom > probe
        })
        if (current) {
          setActive((previous) =>
            previous === current.id ? previous : current.id,
          )
        }
      })
    }
    updateActiveSection()
    window.addEventListener("scroll", updateActiveSection, { passive: true })
    window.addEventListener("resize", updateActiveSection)
    window.addEventListener("hashchange", updateActiveSection)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("scroll", updateActiveSection)
      window.removeEventListener("resize", updateActiveSection)
      window.removeEventListener("hashchange", updateActiveSection)
    }
  }, [])

  const handleNavigate = (sectionId: string) => {
    navigationTargetRef.current = sectionId
    setActive(sectionId)
    window.setTimeout(() => {
      if (navigationTargetRef.current !== sectionId) return
      navigationTargetRef.current = null
      window.dispatchEvent(new Event("scroll"))
    }, 1000)
  }

  const chartTables = {
    income: reportSections
      .slice(0, 3)
      .map((section) =>
        section.tables.find((table) =>
          table.rows[0]?.includes("EST. AVG. HH INCOME"),
        ),
      ),
    heatmap: reportSections
      .slice(0, 3)
      .map((section) =>
        section.tables.find(
          (table) =>
            table.rows[0]?.includes("18-24") &&
            table.rows[0]?.includes("HH >$150K"),
        ),
      ),
    lease: reportSections[3]?.tables.find((table) =>
      table.rows.some((row) => row.includes("TENANT BRAND / CONCEPT")),
    ),
  }

  return (
    <div className={tocOpen ? "app toc-expanded" : "app"}>
      <TableOfContents
        open={tocOpen}
        setOpen={setTocOpen}
        active={active}
        onNavigate={handleNavigate}
      />
      <main>
        <section className="hero" ref={heroRef}>
          <motion.div className="hero-grid" style={{ y: gridY }} />
          <div className="hero-inner">
            <motion.img
              src="/sir-logo.svg"
              alt="Sotheby’s International Realty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8 }}
            />
            <motion.div
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.18 }}
            >
              <p className="hero-kicker">Phase I · Client analysis</p>
              <h1>
                Manhattan F&amp;B
                <br />
                Trade Area Analysis
              </h1>
              <p className="hero-dek">
                Disaggregating micro-market, census tract isolation &amp; adult
                spending class analytics.
              </p>
              <a href="#midtown" className="hero-action">
                Explore the analysis <span>↓</span>
              </a>
            </motion.div>
            <div className="hero-meta">
              <span>Commercial Real Estate</span>
              <span>Food &amp; Beverage</span>
              <span>{REPORT_DATE}</span>
            </div>
          </div>
        </section>

        <section className="overview" aria-label="Report overview">
          <div className="overview-inner">
            <p className="eyebrow">Phase I · Report architecture</p>
            <div className="overview-grid">
              {reportSections.map((section) => (
                <a href={`#${section.id}`} key={section.id}>
                  <span>{section.number}</span>
                  <strong>{section.title}</strong>
                  <small>{section.tables.length} report blocks</small>
                </a>
              ))}
            </div>
          </div>
        </section>

        <header className="phase-divider">
          <span>Phase I</span>
          <div>
            <strong>Market &amp; Retail Analysis</strong>
            <p>
              Midtown South, Downtown, UWS &amp; UES, and retail market
              dynamics.
            </p>
          </div>
        </header>

        {reportSections.map((section, sectionIndex) => (
          <section className="report-section" id={section.id} key={section.id}>
            <header
              className={
                sectionIndex === 3
                  ? "section-header section-header-latest-retail"
                  : "section-header"
              }
            >
              <span
                className={
                  sectionIndex === 3
                    ? "section-number section-number-latest-retail"
                    : "section-number"
                }
              >
                {section.number}
              </span>
              <div>
                <p className="eyebrow">Market analysis</p>
                <h2>
                  {section.title}
                  {sectionIndex < 3 && (
                    <SourceReference sectionId={section.id} />
                  )}
                </h2>
                <p>{section.dek}</p>
              </div>
            </header>
            {sectionIndex < 3 && chartTables.income[sectionIndex] && (
              <Reveal>
                <IncomeChart table={chartTables.income[sectionIndex]!} />
              </Reveal>
            )}
            {sectionIndex === 3 && <TradeAreaMap />}
            {section.tables.map((table, tableIndex) => (
              <div key={table.id}>
                {sectionIndex < 3 &&
                  chartTables.heatmap[sectionIndex] &&
                  table === chartTables.heatmap[sectionIndex] && (
                    <Reveal>
                      <Heatmap table={table} />
                    </Reveal>
                  )}
                {sectionIndex === 3 &&
                  table === chartTables.lease &&
                  chartTables.lease && (
                    <Reveal>
                      <LeaseChart table={chartTables.lease} />
                    </Reveal>
                  )}
                {table !== chartTables.heatmap[sectionIndex] && (
                  <ReportBlock table={table} />
                )}
              </div>
            ))}
          </section>
        ))}

        <TourSiteEvaluation />

        <section
          className="report-section sources-section"
          id="sources"
          aria-labelledby="sources-title"
        >
          <header className="section-header">
            <span className="section-number">S</span>
            <div>
              <p className="eyebrow">Research sources &amp; methodology</p>
              <h2 id="sources-title">Sources &amp; Footnotes</h2>
              <p>
                Source notes are reproduced from the supplied Manhattan F&amp;B
                Trade Area Analysis.
              </p>
            </div>
          </header>
          <article className="source-entry">
            <div>
              <p className="eyebrow">Main Report Sources</p>
              <ol className="source-list">
                <li id="source-1">
                  <strong>
                    NYC Population FactFinder (DCP / U.S. Census Bureau ACS)
                  </strong>
                  <span>
                    Used directly to execute custom Census Tract Isolation,
                    isolate specific micro-market perimeters, and surgically
                    purge public housing block dilution (Data Sourced: October
                    2026).
                  </span>
                </li>
                <li id="source-2">
                  <strong>
                    Cushman &amp; Wakefield Manhattan Retail MarketBeat Reports
                  </strong>
                  <span>
                    Utilized for prime retail corridor availability tracking,
                    transacted submarket inventory metrics, and historical
                    leasing allocations (Data Sourced: Q1 2026, Q2 2026, and Q3
                    2026 Reports).
                  </span>
                </li>
                <li id="source-3">
                  <strong>
                    REBNY (Real Estate Board of New York) Retail Reports
                  </strong>
                  <span>
                    For submarket retail corridor on-market inventory and
                    historical asking rent benchmarks (Data Sourced: Summer 2026
                    Corridor Analysis).
                  </span>
                </li>
                <li id="source-4">
                  <strong>
                    Crexi &amp; LoopNet Commercial Property Marketplace Records
                  </strong>
                  <span>
                    For verified property dimensions, physical configurations,
                    and open market retail availability tracking (Data Sourced:
                    Active October 2026 Live Listings).
                  </span>
                </li>
                <li id="source-5">
                  <strong>
                    NYC Department of Finance ACRIS &amp; Public Brokerage
                    Network Filings
                  </strong>
                  <span>
                    For executed food and beverage lease comparables, floor
                    level allocations, and transacted base rent data grounding
                    (Data Sourced: Transacted Deals 2025–2026).
                  </span>
                </li>
              </ol>
              <p
                className="eyebrow source-group-heading"
                id="market-dynamics-sources"
              >
                Market Dynamics
              </p>
              <ol className="source-list">
                <li>
                  <strong>Permanent Residential Population Metrics (#)</strong>
                  <span>
                    Extracted from the U.S. Census Bureau, American Community
                    Survey (ACS) 5-Year Estimates (2020–2024). Data compiled by
                    isolating specific census tract micro-boundaries to
                    eliminate lower-income housing distortions and legacy
                    rent-regulated tranches.
                  </span>
                </li>
                <li>
                  <strong>Daytime Office Worker Employee Counts</strong>
                  <span>
                    Synthesized via the New York City Department of City
                    Planning (DCP) MapPLUTO™ Database (v24.1) and commercial
                    property footprint registries, cross-referenced with
                    regional employment concentration trends from the New York
                    State Department of Labor (NYS DOL) Bureau of Labor Market
                    Information.
                  </span>
                </li>
                <li>
                  <strong>
                    Pedestrian Foot Traffic Volumes (Daily Peak Counts)
                  </strong>
                  <span>
                    Sourced from the New York City Department of Transportation
                    (NYC DOT) Bi-Annual Pedestrian Volume Analytics Engine,
                    integrated with localized infrared sensor counts and
                    automated turnstile telemetry provided by the respective
                    Manhattan Business Improvement Districts (BIDs) (e.g.,
                    Flatiron NoMad Partnership, Union Square Partnership, and
                    the Meatpacking District Management Association).
                  </span>
                </li>
                <li>
                  <strong>Actual Asking Rent Ranges ($/SF)</strong>
                  <span>
                    Compiled directly from active market availability indexes
                    and historical retail lease comps vetted through premier
                    commercial property tracking engines, including Crexi
                    Intelligence, CoStar Group CRE, and LoopNet Premium Market
                    Analytics, safely benchmarked against quarterly submarket
                    reports published by Tier-1 commercial real estate brokerage
                    houses (CBRE, JLL, and Cushman &amp; Wakefield).
                  </span>
                </li>
              </ol>
              <nav
                className="source-backlinks"
                aria-label="Footnote 2 references"
              >
                <span>Referenced from</span>
                <a href="#source-ref-2-retail-rental-ranges">Section 4.2</a>
              </nav>
              <nav
                className="source-backlinks"
                aria-label="Footnote 1 references"
              >
                <span>Referenced from</span>
                {reportSections.slice(0, 3).map((section) => (
                  <a
                    key={section.id}
                    href={`#source-ref-1-${section.id}`}
                    aria-label={`Return to ${section.title}`}
                  >
                    Section {section.number.replace(/^0/, "")}
                  </a>
                ))}
              </nav>
            </div>
          </article>
        </section>

        <footer>
          <img src="/sir-logo.svg" alt="Sotheby’s International Realty" />
          <div>
            <h2>Manhattan F&amp;B Trade Area Analysis</h2>
            <p>Prepared for client discussion · {REPORT_DATE}</p>
          </div>
          <p>
            All figures and narratives reproduced from the supplied revised
            analysis and tour-site materials.
          </p>
        </footer>
      </main>
    </div>
  )
}
