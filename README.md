# Manhattan CRE Matrix

Interactive client-side presentation for the **Manhattan F&B Trade Area Analysis** (Sotheby's International Realty / CRE Matrix). Built with React 19, Vite 8, TypeScript, and Tailwind CSS v4. The app turns the report’s sections, tables, underwriting briefs, demographic matrices, and corridor catchments into a single-page visual document—no backend or auth.

Production is already connected to Vercel: [manhattan-cre-matrix.vercel.app](https://manhattan-cre-matrix.vercel.app/). Deploy again from this repo after you make local updates; do not treat the live site as the edit surface.

## Stack

- React 19 + React DOM
- Vite 8 + TypeScript 5.7
- Tailwind CSS v4 (`@tailwindcss/vite`)
- pnpm
- Leaflet, Recharts, Framer Motion

## Local development

```bash
pnpm install
pnpm dev
```

Default Vite host is `0.0.0.0`; port comes from `$PORT` (defaults to `8443` in `vite.config.ts`). To use a specific port:

```bash
PORT=3847 pnpm dev --host 0.0.0.0 --port 3847
```

## Build & preview

```bash
pnpm build
pnpm preview
```

## Project layout

- `src/App.tsx` — main report UI (set `SITE_AVAILABLE` to restore the full app vs. Coming Soon gate)
- `src/ComingSoon.tsx` — soft public takedown page
- `src/data/` — report tables and section content
- `vite.config.ts` — Vite + Tailwind + Figma Make plugins

## Notes for agents

See `AGENTS.md` for Figma Make / Tailwind conventions used in this scaffold.
