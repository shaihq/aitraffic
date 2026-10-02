# Bengaluru AI Traffic

A game-style clay diorama of Bangalore in the late afternoon, whose traffic is driven by real AI-model usage routed through OpenRouter. Token volume becomes traffic volume, and surges become jams.

Each provider's traffic lives in a real neighbourhood (Koramangala, Silk Board, Whitefield, Electronic City, Hebbal, …). Real arterials link them: the Outer Ring Road, the Hebbal and Silk Board flyovers, the Electronic City elevated expressway, and Namma Metro. Landmarks include Vidhana Soudha, Cubbon Park, Lalbagh and the lakes. Which neighbourhood hosts which model is just a label, set in `lib/bangalore.ts`. **The traffic is AI usage, not real Bangalore traffic.**

## Run

```bash
cp .env.example .env.local   # add a fresh OpenRouter key (server-only, never NEXT_PUBLIC_)
npm install
npm run dev
```

Without a key, the app runs in an explicitly labeled **DEMO MODE** with deterministic synthetic usage. Model names still come from the live OpenRouter catalog.

The app opens on a game title screen at street level in MG Road. The city loads behind it. Pick a sound mode (music + city, city only, or muted), then press **Start** (or Enter) to fly up into the neighbourhood view.

Quality levels: `/?quality=high` (default on desktop: shadows and depth of field), `/?quality=medium` (depth of field, no shadows, fewer objects) and `/?quality=low` (no post-processing; used automatically on phones).

## How data flows

```
Browser → /api/traffic → server cache (memory + .cache/ on disk) → OpenRouter
```

- `GET /api/v1/models` (public) is used to discover each provider's current model. The "Latest" family alias (`~author/...-latest` → `alias_target`) is preferred. Otherwise the newest listed text model is used. When a provider has several Latest families, the one carrying the most traffic over the last 14 days wins.
- `GET /api/v1/datasets/rankings-daily` (needs a key) is fetched in 92-day windows for up to a year and cached for 3 hours. If OpenRouter is down, the last cached copy is served and labeled stale.
- The rankings list the **top 50 models per day**. Days where a model is absent are counted as 0 and flagged in the UI.
- `/api/models` shows which aliases exist and what the catalog-only rule resolves to.

## Data → traffic

| Data | Traffic |
| --- | --- |
| 7-day avg daily tokens (log-scaled to the live distribution) | vehicles per lane |
| week-over-week growth | extra density, "intensifying/easing" |
| day-over-day volatility | brake events → stop/start shockwaves, lane weaving |
| spike (σ above 14-day baseline) | congestion: lane-drop bottleneck, longer reds, `JAMMED` |
| total OpenRouter volume | Outer Ring Road traffic (arterials blend it with their neighbourhoods) |

Congestion comes from surges and instability, not from popularity. A huge, steady corridor flows smoothly. Constants are in `scene/config.ts` (`TRAFFIC_SCALE`).

## Layout

- `lib/openrouter`: server-only fetch, cache, and payload assembly
- `lib/provider-mapping`: provider list and the latest-model rule
- `lib/analytics`: metrics, traffic states, data-derived events
- `lib/traffic-engine`: per-timeline-day snapshot
- `lib/bangalore.ts`: neighbourhood coordinates, routes, metro lines, landmarks, and the provider → neighbourhood mapping
- `scene/`: Three.js city, with the road network, an IDM traffic simulation, instanced vehicles, metro, pedestrians, the camera, foliage and a depth-of-field pass. Vehicles get suspension and wheel physics. People get walk cycles and wait for the signal before crossing. It runs outside React.
- `audio/`: synthesized Web Audio soundscape, including traffic, horns, birdsong, a generative music loop and UI sounds (no recordings)
- `components/`: title screen, navigation, info overlay, timeline, audio/view controls (dark game UI in `app/globals.css`)

Data: OpenRouter rankings, CC BY 4.0. Source: OpenRouter (openrouter.ai/rankings).
