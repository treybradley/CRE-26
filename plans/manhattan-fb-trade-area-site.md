# Manhattan F&B Trade Area Interactive Website Plan

## Objective

Build a polished, client-meeting-ready single-page React experience that faithfully reproduces the complete contents of the supplied **“Manhattan F&B Trade Area Analysis (25 October 2026)”** DOCX. The experience will turn the report’s four sections, 30 tables, underwriting briefs, tract exclusions, demographic matrices, and lease comparables into an interactive visual document without omitting source rows.

The site is a presentation artifact, not a data-entry application. It will remain entirely client-side with no backend, authentication, or persistence.

## Confirmed Direction

- Content depth: **full document reproduction**.
- Preserve every source table, row, value, and underwriting brief.
- Improve formatting artifacts introduced by the DOCX (merged labels, line breaks, encoded ampersands, duplicated visual labels), but do not silently alter substantive claims or values.
- Use the source report date and identify the DOCX as the source; do not independently validate or refresh the report’s figures.
- Use the supplied white Sotheby’s International Realty SVG only on sufficiently dark blue surfaces.
- Do not add a geographic map because the source supplies boundaries rather than geographic geometry; the required heatmap will visualize the tract-level demographic matrices.

## Visual and Brand Direction

- Primary color: `#1F4E79`.
- Supporting palette:
  - Deep navy for presentation surfaces and footer.
  - Warm ivory/off-white for report pages.
  - Muted blue-gray for secondary text and table chrome.
  - Restrained teal/gold accents for chart series and emphasis while maintaining the Sotheby’s blue as dominant.
- Typography:
  - Load **EB Garamond** for headings and large numeric callouts, with Garamond/Georgia fallbacks.
  - Use Arial for body copy, controls, labels, tables, and chart text.
- Style:
  - Editorial real-estate report aesthetic with generous whitespace, thin rules, refined serif hierarchy, and data-dense surfaces.
  - Glassmorphism used selectively for the floating navigation, chart tooltips, hover cards, and key metric overlays—not as a blanket effect that hurts readability.
  - Rounded corners and shadows remain subtle and professional.

## Information Architecture

### 1. Cover / Executive Opening

- Full-viewport branded opening with:
  - Sotheby’s International Realty logo.
  - “Phase I. Manhattan F&B Trade Area Analysis.”
  - Report subtitle and date.
  - Compact “Explore analysis” action that advances to the first section.
- Add a restrained abstract Manhattan-grid/data texture using CSS only; no unrelated stock photography.
- Include a small report-scope strip summarizing the four report sections without inventing new metrics.

### 2. Persistent Expandable Table of Contents

- Desktop:
  - Fixed left-side rail.
  - Collapsed state shows a compact menu control and current section marker.
  - Expanded state shows all four sections and their report subsections.
- Mobile/tablet:
  - Sticky top bar opens a modal/drawer table of contents.
- Behavior:
  - Anchor navigation with smooth scrolling.
  - Active subsection updates through `IntersectionObserver`.
  - Selecting an item closes the mobile drawer and focuses the destination heading.
  - URL hash updates for deep linking without adding a router.

### 3. Section 1 — Midtown South Micro-Markets

Reproduce:

- Geographic and macro demographics.
- 7-day residential catchment corridor.
- Macro demographic underwriting brief.
- Census tract exclusions.
- Census tract isolation and F&B focus.
- 7-day hybrid capture underwriting brief.
- Tract-level age and ultra-high-income distribution matrix.
- Moynihan/Penn catchment matrix.
- Age/income/household underwriting brief.

Visual treatment:

- Neighborhood income comparison chart.
- Complete responsive demographic and tract tables.
- Midtown age/income heatmap.
- Underwriting briefs split into clearly labeled driver, behavior, wealth, and ideal-format cards while retaining all original text.

### 4. Section 2 — Downtown Micro-Markets

Reproduce all source material for:

- Macro demographics.
- Census tract exclusions.
- Tract isolation and F&B focus.
- 7-day hybrid capture.
- Age and ultra-high-income matrix.
- Associated underwriting briefs.

Visual treatment:

- Average versus median household-income comparison.
- Downtown demographic heatmap.
- Full tract table in an expandable report panel, with neighborhood grouping retained.

### 5. Section 3 — UWS & UES Micro-Markets

Reproduce all source material for:

- Macro demographics.
- Census tract exclusions.
- All 38 detailed tract rows and F&B focus descriptions.
- 7-day hybrid capture.
- Age and ultra-high-income matrix.
- Associated underwriting briefs.

Visual treatment:

- Uptown neighborhood income comparison.
- UWS/UES demographic heatmap.
- Large tract table grouped by neighborhood, with sticky headers and expandable/collapsible neighborhood groups to keep all content available without forcing one uninterrupted scroll.

### 6. Section 4 — Retail Market Dynamics & Food Lease Comparables

Reproduce:

- True trade-area capture matrix.
- 5- and 10-minute walk-radius trade-area breakdown.
- 18-hour daytime-population multiplier table.
- Walk-radius drivers and spending underwriting brief.
- Ground-floor and lower-level rental ranges.
- Food & Beverage committed lease comparables.
- Rental and lease underwriting briefs.

Visual treatment:

- Corridor workforce/resident/student composition chart.
- Ground-floor rent-range chart using floating range bars.
- Lease comparable bar chart for executed base rent.
- Complete data tables directly below each chart so exact values and deal notes remain accessible.

### 7. Source / Closing

- Branded closing panel with report title, date, and “Prepared for client discussion” language.
- State that all figures and narratives are reproduced from the supplied analysis.
- Do not add unsupported methodology, contact information, or calls to transact.

## Content and Data Model

Create a dedicated typed data module rather than embedding report content throughout JSX.

Suggested structures:

- `ReportSection`
- `NeighborhoodDemographic`
- `CatchmentRow`
- `TractDetail`
- `DemographicMatrixRow`
- `UnderwritingBrief`
- `TradeAreaRow`
- `RentRange`
- `LeaseComparable`

Store numeric chart values as numbers while retaining display labels for exact formatting (`$475K`, `52.4%`, `$175–$250 / SF`). Keep long narrative strings and boundary descriptions verbatim after typographic cleanup. Build tables and charts from the same data objects so visual summaries cannot diverge from displayed source values.

## Component Plan

Keep the implementation compact but split reusable presentation behavior from report content:

- `src/App.tsx`
  - Page composition, section ordering, navigation state.
- `src/data/reportData.ts`
  - Full normalized transcription of the DOCX.
- `src/components/TableOfContents.tsx`
  - Desktop rail and mobile drawer.
- `src/components/SectionHeader.tsx`
  - Number, title, synopsis, and section anchor.
- `src/components/DataTable.tsx`
  - Responsive table shell, sticky header, horizontal overflow cue, and optional grouped rows.
- `src/components/DemographicHeatmap.tsx`
  - Accessible matrix visualization.
- `src/components/ReportCharts.tsx`
  - Reusable Recharts wrappers for income, population, rent-range, and lease comparable visuals.
- `src/components/UnderwritingBrief.tsx`
  - Structured rendering of source underwriting narratives.
- `src/components/Reveal.tsx`
  - Shared Framer Motion scroll reveal with reduced-motion fallback.
- `src/index.css`
  - Font import, Tailwind theme tokens, global base styles, print styles, scrollbar/table utilities, and glass treatments.
- `public/sir-logo.svg`
  - Supplied attachment copied unchanged.

Exact file grouping may be consolidated if a component is only used once, but data must remain separate from rendering.

## Interactive Behavior

### Charts

- Add `recharts`.
- Use `ResponsiveContainer` for all chart layouts.
- Animate once when each chart enters the viewport, not on every scroll.
- Provide glass-style custom tooltips containing exact values and units.
- Keep legends concise and allow series highlighting where useful.
- Disable or shorten animation when `prefers-reduced-motion` is enabled.

### Heatmap

- Render one heatmap per regional demographic matrix.
- Rows represent neighborhoods; columns represent age bands, households with kids, and wealth thresholds.
- Normalize color intensity within logical metric groups:
  - Age and household-composition percentages.
  - Wealth-threshold percentages.
- Show the exact percentage in every cell; color is supplemental, never the sole carrier of information.
- Hover/focus reveals neighborhood, metric, exact percentage, and census tract IDs in a glass tooltip.
- On narrow screens, preserve the matrix with horizontal scrolling rather than shrinking values below readable size.

### Tables

- Use semantic HTML tables; Recharts is reserved for chart visualizations rather than forcing tabular content into SVG.
- Sticky column headers on long tables.
- Sticky first column where practical on wide desktop tables.
- Horizontal scroll with a visible edge fade and keyboard-accessible container on mobile.
- Long tract sections can collapse by neighborhood, but all groups default open on first visit to satisfy full reproduction.
- Add a compact “Expand all / Collapse all” control only for grouped tract tables.

### Motion

- Add `framer-motion`.
- Use restrained section reveal, chart entrance, TOC expansion, card hover, and number emphasis.
- Use a lightweight parallax transform on the cover’s decorative layers only.
- Avoid scroll-jacking, page-transition gimmicks, and continuous motion.
- Respect `prefers-reduced-motion`.

## Responsive and Accessibility Requirements

- Desktop presentation optimized for common meeting screens at 1440px and above.
- Fully usable at tablet and mobile widths.
- Maintain WCAG AA contrast, especially over translucent surfaces.
- Keyboard-operable TOC, drawers, collapsible groups, tooltips, and chart/table controls.
- Visible focus styles using the primary blue and a high-contrast outline.
- Semantic heading hierarchy and landmark regions.
- Charts receive concise text summaries and remain paired with complete tables.
- Decorative graphics are hidden from assistive technology; the logo has appropriate alternative text.
- Lock body scroll while the mobile TOC drawer is open and return focus to the trigger when closed.

## Dependencies

Install only:

- `recharts`
- `framer-motion`
- `lucide-react` for consistent interface icons

No router, mapping package, state-management library, or backend dependency is needed.

## Implementation Sequence

1. Copy the provided logo into `public/` and install the three UI dependencies.
2. Normalize the DOCX content into typed report data, preserving all 30 tables and briefs.
3. Establish brand tokens, typography, global layout, accessible base styles, and print behavior.
4. Build the cover, fixed/collapsible TOC, section shell, and active-section tracking.
5. Build shared table and underwriting-brief components.
6. Build Recharts visualizations and the accessible demographic heatmap.
7. Compose all four sections and verify each source table/brief is represented.
8. Add restrained Framer Motion reveals and cover parallax with reduced-motion handling.
9. Refine desktop, tablet, mobile, and print layouts.

## Verification

Because this is a broad new interface, run:

1. `pnpm format`
2. `pnpm build`

Then manually verify in the existing preview:

- Logo renders correctly against branded surfaces.
- All four sections and all report subsections appear in the TOC.
- Every one of the 30 source tables/brief blocks is represented and row counts match the DOCX.
- TOC collapse/expand, deep links, active highlighting, and focus transfer work.
- All chart tooltips and heatmap hover/focus states show exact values.
- Charts animate once on entry and reduced-motion mode removes nonessential movement.
- Long tables are readable and operable at desktop, tablet, and mobile widths.
- No clipped labels, layout overflow, console errors, or illegible glass effects.
- Print preview remains coherent and exposes collapsed content where feasible.

## Acceptance Criteria

- The site visibly follows the requested Garamond/Arial typography and `#1F4E79` branding.
- The supplied Sotheby’s International Realty logo is used accurately and legibly.
- All source content is present, organized by the four report sections, and accessible without relying on a continuous linear scroll.
- Recharts powers meaningful interactive charts; age/income matrices are available as heatmaps.
- The TOC is expandable/collapsible, responsive, keyboard accessible, and jumps to individual subsections.
- Glassmorphism, hover behavior, scroll-triggered chart animation, cover parallax, and Framer Motion interactions feel polished but restrained.
- The interface is responsive, accessible, and builds successfully.
