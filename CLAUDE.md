# CLAUDE.md — AI Traffic

## Project

Build **AI Traffic**, an immersive 3D data visualization that turns AI model usage into evening traffic in a cartoon miniature of Bangalore.

The conceptual thesis is:

> **AI usage is invisible flow. Make that flow physical by representing it as traffic.**

The product is inspired by the idea behind Token Town, but **must not recreate Token Town's town/building metaphor**. The experience should feel like a living 3D transportation system: roads, intersections, vehicles, congestion, movement, sound, and city ambience.

A user sees a broad 3D city traffic scene. At the top is a navigation strip using the provider/model labels from the supplied visual reference. Clicking a model moves/focuses the camera into that model's traffic environment.

The image reference shows these labels:

- DeepSeek
- OpenAI
- Z.ai
- Xiaomi
- Tencent
- NVIDIA
- Gemini
- Claude
- Qwen
- Meta
- Kimi
- MiniMax
- Grok
- Mistral

For V1, use **the latest/current model for each of these providers where OpenRouter exposes a clear latest model/family entry**. Do not maintain a hardcoded historical model list. Discover current models dynamically from OpenRouter and choose the provider's latest relevant text model/family entry. OpenRouter currently exposes "Latest" family aliases for several providers, including Anthropic Claude Sonnet, Google Gemini Pro/Flash, Moonshot Kimi, and others. The exact current model inventory changes over time, so the application should not hardcode today's model names.

---

# 1. Product experience

The first impression should be:

> **"I'm looking at a living AI city whose traffic is driven by real usage."**

The experience should prioritize atmosphere and exploration over dashboards.

The core loop is:

```text
OPEN AI TRAFFIC
      ↓
SEE A LIVING 3D CITY
      ↓
NOTICE DIFFERENT TRAFFIC DENSITIES
      ↓
CLICK A MODEL
      ↓
CAMERA NAVIGATES TO THAT MODEL'S DISTRICT
      ↓
TRAFFIC / SOUND / ENVIRONMENT CHANGE
      ↓
INSPECT REAL USAGE DATA
      ↓
SCRUB / WATCH HISTORICAL TRAFFIC CHANGE
```

---

# 2. Data source — OpenRouter

Use the official OpenRouter Data API, **not webpage scraping**.

OpenRouter's public rankings are based on tokens processed through OpenRouter. The rankings count **prompt + completion tokens**, aggregate them into UTC daily buckets, and total usage per model variant. The official Data API exposes the same rankings data as JSON. OpenRouter states that this represents traffic routed through OpenRouter, **not total AI usage across the industry**.

Official data endpoint:

```text
GET https://openrouter.ai/api/v1/datasets/rankings-daily
```

Authentication uses an OpenRouter API key.

Environment variable:

```env
OPENROUTER_API_KEY=...
```

### Security requirement

**Never put the API key in this `CLAUDE.md`, source code, client-side JavaScript, or any public environment variable.**

The API key supplied in the conversation must be treated as compromised because it has been pasted into chat. **Do not copy it into the repository. Use a fresh/rotated key in `.env.local`.**

Recommended local setup:

```env
# .env.local
OPENROUTER_API_KEY=your_new_key_here
```

Never use:

```env
NEXT_PUBLIC_OPENROUTER_API_KEY=...
```

The browser should call a server-side Next.js endpoint, and that endpoint should call OpenRouter.

---

# 3. OpenRouter model discovery

The app needs two related data streams:

### A. Usage data

Use the rankings Data API to retrieve daily model usage.

### B. Model metadata

Use OpenRouter's model catalog to discover currently supported models and provider/author metadata.

The application should dynamically identify the latest/current model or latest family entry for the providers represented in the top navigation.

Do not assume a model slug stays constant forever. OpenRouter's documentation notes that model identifiers can change as new versions ship, and the platform exposes latest-family aliases.

### Provider matching

Create a normalized provider mapping such as:

```ts
const PROVIDERS = [
  { key: 'deepseek', label: 'DeepSeek', authors: ['deepseek'] },
  { key: 'openai', label: 'OpenAI', authors: ['openai'] },
  { key: 'zai', label: 'Z.ai', authors: ['z-ai', 'zai'] },
  { key: 'xiaomi', label: 'Xiaomi', authors: ['xiaomi'] },
  { key: 'tencent', label: 'Tencent', authors: ['tencent'] },
  { key: 'nvidia', label: 'NVIDIA', authors: ['nvidia'] },
  { key: 'google', label: 'Gemini', authors: ['google'] },
  { key: 'anthropic', label: 'Claude', authors: ['anthropic'] },
  { key: 'qwen', label: 'Qwen', authors: ['qwen'] },
  { key: 'meta', label: 'Meta', authors: ['meta-llama', 'meta'] },
  { key: 'moonshotai', label: 'Kimi', authors: ['moonshotai'] },
  { key: 'minimax', label: 'MiniMax', authors: ['minimax'] },
  { key: 'x-ai', label: 'Grok', authors: ['x-ai'] },
  { key: 'mistral', label: 'Mistral', authors: ['mistralai'] },
];
```

This is a starting normalization layer, not a guarantee that every provider currently uses exactly these author IDs. Validate against live OpenRouter metadata and make matching tolerant.

If a provider has no clear current model, hide it gracefully rather than inventing one.

---

# 4. Latest model rule

The user specifically wants the latest/current model for each provider represented in the navigation.

Use this rule:

1. Prefer an OpenRouter **Latest** family alias where one exists and is clearly associated with the target provider.
2. Otherwise use the newest currently listed relevant text model from OpenRouter's model catalog.
3. If multiple latest families exist (for example Pro and Flash), choose the primary/main family unless the product has a clear reason to show more than one.
4. Display the human-readable latest model name in the selected-model panel.
5. Do not hardcode today's model names as permanent truth.

The top navigation label should remain provider-oriented, e.g. `Claude`, while the selected model detail can say `Claude Sonnet ...` with the live resolved model name.

---

# 5. Traffic data model

Normalize data into a model-centric structure.

```ts
interface ModelTraffic {
  providerKey: string;
  providerLabel: string;
  modelId: string;
  modelName: string;

  currentTokens: number;
  previousPeriodTokens: number;
  wowGrowth: number | null;
  thirtyDayTokens: number | null;
  volatility: number | null;
  spikeScore: number | null;

  activityNormalized: number;
  growthNormalized: number;
  congestion: number;
  flowSpeed: number;
}
```

The product should remain honest about the underlying measurement.

**Token volume is a proxy for traffic volume in this visualization.**

Do not label it as literal counts of cars, users, requests, or money.

---

# 6. Data → traffic mapping

This is the heart of the product.

### Token usage → number of vehicles

Higher usage means a larger continuous stream of traffic.

```text
Low usage     → sparse vehicles
Medium usage  → steady traffic
High usage    → dense traffic
Extreme usage → near-gridlock / massive flow
```

Use logarithmic/compressed scaling. A model with 100× more tokens should not produce an unusably huge 100× visual difference.

### Growth → increasing traffic density

Positive growth should increase the rate/density of vehicles entering the system.

Negative growth should gradually reduce the flow.

### Volatility → stop/start behavior

A volatile model can show irregular traffic flow, brief slowdowns, and accelerations.

### Sudden spike → traffic jam

An extreme usage spike should create a visible temporary congestion event.

### New/increasing model → new route activity

If a provider/model is newly gaining attention, traffic should visibly begin appearing on its routes.

### Sustained decline → roads clearing

Traffic should not instantly disappear. It should gradually thin out.

---

# 7. IMPORTANT: this is a miniature of real Bangalore

*(Updated per the user's direction, Oct 2026 — this replaces the earlier "fictional city" rule.)*

The city is a **simplified, cartoon miniature of real Bangalore**:

- each provider's traffic lives in a **real neighbourhood** (Koramangala, Silk Board, Whitefield, Electronic City, Hebbal, Indiranagar, MG Road, Majestic, Jayanagar, …) placed at its approximate real location
- **real major roads**, simplified: Outer Ring Road, Bellary Road–Hosur Road (Hebbal flyover, Silk Board flyover, Electronic City elevated expressway), Tumkur Road–Old Madras Road, Old Airport Road–Whitefield
- **Namma Metro** Purple / Green / Yellow lines
- recognizable **landmarks**: Vidhana Soudha, Cubbon Park, Lalbagh Glass House, Bangalore Palace, Chinnaswamy Stadium, UB City, lakes (Ulsoor, Bellandur, Hebbal, …)
- smaller labels for many other neighbourhoods so the whole city reads as Bangalore

Keep the Bangalore traffic *feel*: chaotic flows, bottlenecks, merging, stop/start, autos and two-wheelers, honking.

Honesty rules still apply:

- the neighbourhood ↔ provider assignment is a **label only** (editable in `lib/bangalore.ts`)
- the traffic shown is **AI token usage, not real Bangalore road traffic** — say so in the UI
- no real-time traffic feeds, traffic-camera imagery, or copied Google Maps tiles

---

# 8. 3D city world

The city should be stylized and atmospheric rather than photorealistic.

Primary elements:

- roads
- intersections
- bridges/flyovers
- tunnels
- buildings as environmental massing
- street lights
- lane markings
- traffic signals
- vehicles
- distant skyline
- atmospheric haze

Do not over-model buildings. The road network and traffic are the star.

The city should be readable from a high camera position and become more immersive as the camera moves closer to a selected model's district.

---

# 9. City organization

Do not use building/shop metaphors from Token Town.

Instead, organize the city as a **transportation network**.

Each provider/model should correspond to a named traffic district or primary corridor.

Examples:

```text
Claude      → Claude Corridor
OpenAI      → OpenAI Ring
Gemini      → Gemini Express
DeepSeek    → DeepSeek Junction
```

These are labels, not literal brand-owned roads.

The important mapping is:

```text
provider/model → traffic system
usage           → traffic volume
change          → changing traffic conditions
```

---

# 10. Navigation between models

The navigation shown in the supplied reference image should become the primary model selector.

At the top of the screen, render a compact horizontal list of provider labels.

The selected provider should have a subtle pill/background treatment similar in interaction concept to the reference screenshot, but **do not copy the exact visual design**.

When a user clicks a provider/model:

1. preserve the current scene
2. smoothly move/rotate the camera toward that model's traffic district
3. increase local detail
4. emphasize the selected traffic flows
5. slightly de-emphasize unrelated regions
6. update the information overlay
7. update the audio mix

Camera movement should feel like an intentional journey through the city, not an instant teleport.

---

# 11. Camera system

Support at least three conceptual levels:

### Overview

High-level view of the whole city.

### District

Camera focuses on the selected model's traffic area.

### Street

Camera comes close to vehicle level, allowing the user to feel the traffic.

The user should be able to return to Overview easily.

Do not make navigation dependent on a complex control scheme.

---

# 12. Vehicle system

Vehicles are visual representations of token activity.

They can be simple low-poly shapes with emissive headlights/taillights.

Prioritize:

- motion
- density
- lane behavior
- believable spacing
- variety in vehicle silhouettes

Do not create detailed individual cars unless performance allows it.

Use instancing or another efficient technique so hundreds/thousands of vehicles can be rendered without creating thousands of heavyweight scene objects.

The exact number of visible vehicles is a **visual scale**, not a literal token-to-car conversion.

For example:

```text
1 traffic unit = many millions/billions of tokens
```

Choose a stable scaling function and expose the scale as a configuration constant.

---

# 13. Traffic simulation

The traffic should not look like particles randomly moving in straight lines.

Vehicles should:

- follow lanes
- slow down before intersections
- queue naturally
- accelerate after signals clear
- maintain approximate spacing
- merge where appropriate
- move continuously around loops/corridors

Use a lightweight custom traffic simulation rather than a heavyweight physics engine unless there is a compelling reason otherwise.

The simulation should be **data-driven but deterministic**. The same traffic state should produce broadly similar behavior across reloads.

Use seeded randomness for variation.

---

# 14. Traffic states

Use a small vocabulary:

### FREE FLOW
Low-to-moderate activity.

### BUSY
High steady activity.

### HEAVY
Very high traffic volume.

### CONGESTED
Flow is substantially slowed.

### JAMMED
Extreme spike/low throughput state.

### CLEARING
Usage is declining and traffic density is falling.

These states are descriptive visual states, not judgments about model quality.

---

# 15. Traffic speed vs traffic volume

Do not assume that more tokens always means faster traffic.

Separate two concepts:

**Volume** = amount of traffic

**Flow speed** = how smoothly traffic moves

A very popular model can therefore have:

```text
Huge volume + smooth movement
```

or:

```text
Huge volume + severe congestion
```

This distinction makes the metaphor substantially more interesting.

A traffic jam should represent an unusual surge or instability, not simply popularity.

---

# 16. Historical mode

Include a time control allowing the user to move through history.

At minimum:

- 7 days
- 30 days
- 90 days
- 1 year where sufficient data exists

As the timeline moves, the traffic system should evolve:

```text
small flow
   ↓
traffic increases
   ↓
roads become busier
   ↓
intersection starts backing up
   ↓
heavy congestion
   ↓
traffic clears / stabilizes
```

Do not simply change a number on screen. The user should **see traffic behavior change**.

---

# 17. Traffic events

Create data-derived events.

Examples:

### TRAFFIC SURGE
Usage has increased sharply relative to the previous period.

### MAJOR JAM
Large short-term usage spike.

### CLEARING
Sustained decline has reduced traffic.

### NEW ROUTE
A newly visible model/provider is accumulating meaningful activity.

### FLOW SHIFT
One route is growing while another contracts.

### NIGHT SHIFT
Optional stylistic state based on time-of-day simulation; do not imply it is real-world local traffic.

Every event must be tied to explicit data logic.

Do not invent causality.

---

# 18. Sound design

Sound is a major part of the experience.

The selected model's traffic area should have a spatial/immersive soundscape.

Possible layers:

- low city ambience
- road noise
- tire/road hiss
- distant horns
- signal beeps
- engine loops
- flyover/tunnel ambience
- congestion intensity
- subtle UI transition sounds

Do not use recognizable copyrighted recordings without a license.

Prefer generated/synthesized/appropriately licensed sounds.

### Audio mapping

Traffic volume → number/intensity of sound layers.

Traffic density → road noise intensity.

Congestion → more irregular signal/horn activity.

Camera distance → volume / filtering.

Selecting a provider → gentle spatial transition into that provider's soundscape.

Respect browser autoplay restrictions. Audio should begin after a user gesture.

Provide a simple mute/unmute control (the in-game sound button cycles Music + city → City only → Muted). Music is a synthesized, generative cozy-game loop; UI buttons have small synthesized click sounds.

---

# 19. Visual style

*(Updated per the user's direction, Oct 2026.)*

A **modern game-style clay diorama** of Bangalore (think stylized toy-world games / clay dioramas):

- soft clay materials with a gentle rim light; rounded, chunky shapes everywhere
- mint-green ground, sandy sidewalks with little kerbs, tiered scalloped pines, puffy trees, leafy plants, grass tufts, flowers, white picket fences
- chibi townsfolk (big heads, simple faces) and toy vehicles — green-and-yellow autos, BMTC buses, two-wheelers, lorries
- Bangalore details: rooftop water tanks, shop awnings, gabled clay-roof houses, Namma Metro
- **depth of field** around the focus point (macro-lens miniature look) — not white haze/fog fades

Game-feel physics (render-side, on top of the traffic simulation):

- vehicles: spring-damper suspension (nose-dive on braking, squat on acceleration, roll in turns; two-wheelers lean in), rolling and steering wheels, bouncy pop-in
- junction boxes: vehicles yield while cross traffic is still inside, and don't enter if the queue beyond would trap them
- people: walk cycles, eased starts/stops, personal-space avoidance, waiting at the kerb for a red on the road they cross
- metro: smooth acceleration and braking into stations

Interface: a **tactical game UI in the spirit of Valorant**:

- sharp panels with cut corners, near-black slate surfaces, off-white type, one red accent (#ff4655)
- condensed uppercase type: Bebas Neue for headlines, Barlow Condensed for UI, Barlow for small body text
- buttons with a fill that wipes in on hover; segmented controls with a sliding red block; map pins as slate tags with a red edge
- title reveal: a red block wipes across each line and reveals the text as it leaves, with an occasional glitch; HUD slides in quickly after Start (no bounce)

The 3D world should carry most of the visual communication.

---

# 20. Lighting

**Late afternoon, turning to evening** in Bangalore:

- warm sun from the west with soft shadows; pastel blue-to-peach sky (bright enough for clay colours)
- street lamps, some windows, shop fronts, headlights and tail lights starting to glow
- distance handled with edge blur and only a faint dusk tint at the far horizon — no white fog
- avoid heavy bloom/neon; keep it warm, clean and readable

---

# 21. Information overlay

When a provider/model is selected, show the real underlying data in a lightweight overlay.

Example:

```text
CLAUDE
Claude Sonnet ...

18.2B TOKENS
+42% THIS WEEK

TRAFFIC: HEAVY
FLOW: INTENSIFYING
```

The exact model name must come from live OpenRouter metadata.

The token statistic must come from OpenRouter usage data.

Always show the data period, e.g.:

```text
Usage through Oct 1, 2026 UTC
```

Do not imply real-time traffic if the source is daily aggregated data.

---

# 22. Honest data labeling

The product should clearly state somewhere accessible:

```text
AI Traffic visualizes aggregate model usage routed through OpenRouter.
Token volume is represented as traffic volume.
This does not represent total AI usage across all providers.
```

Use OpenRouter attribution and comply with its published data license terms.

OpenRouter states that rankings data are available under CC BY 4.0 and intended for reuse with attribution.

Do not describe token rankings as a measure of model intelligence, accuracy, quality, or overall market dominance.

---

# 23. Homepage information hierarchy

Primary:

```text
AI TRAFFIC

Live traffic across the AI model ecosystem
```

Then the 3D scene.

Secondary:

Provider/model navigation.

Tertiary:

Selected model's exact usage metrics.

The page should not begin with a dashboard of cards.

---

# 24. Architecture

Use a modern Next.js + TypeScript application.

Separate concerns roughly as:

```text
/app
  page.tsx
  api/
    rankings/
    models/

/lib
  openrouter/
  analytics/
  provider-mapping/
  traffic-engine/

/components
  ModelNav/
  ModelInfo/
  Timeline/
  AudioControl/

/scene
  CityScene/
  RoadNetwork/
  VehicleSystem/
  TrafficSimulation/
  CameraController/

/audio
  AudioManager/

/shaders
  traffic / atmosphere shaders
```

Do not force this exact directory structure if the chosen 3D library has a better convention. Keep the architectural separation intact.

---

# 25. Recommended 3D stack

Prefer a web-native 3D stack suitable for Next.js.

A practical default is:

- Three.js
- React Three Fiber where useful
- Drei where useful
- TypeScript
- Web Audio API for sound management

Do not use a full game engine unless a clearly demonstrated requirement justifies it.

The visualization must remain web-first.

---

# 26. Rendering performance

Performance is critical.

Targets:

- smooth camera motion
- stable traffic simulation
- responsive navigation
- no obvious hitching when changing providers

Use:

- instanced rendering for vehicles
- object pooling
- deterministic seeded randomness
- low-poly vehicle geometry
- shared materials
- efficient path representations
- distance-based detail reduction
- frustum culling where useful

Avoid creating thousands of React components for individual cars.

The traffic simulation should run primarily outside React's component reconciliation path.

---

# 27. Mobile / reduced-motion

Desktop is the primary experience.

Still provide a usable mobile version.

On mobile:

- reduce vehicle count
- reduce scene detail
- simplify camera movement
- retain provider navigation
- preserve the ability to inspect exact data

Respect:

```text
prefers-reduced-motion
```

In reduced-motion mode, significantly reduce continuous animation and camera transitions.

---

# 28. Loading state → title screen

*(Updated per the user's direction, Oct 2026.)*

Instead of a blank loader, the app opens on a **game title screen**:

- the city loads behind it; the Start button doubles as the progress bar
  (`Connecting to AI Traffic → Loading model data → Building Bangalore → Opening roads`)
- once ready, the background is the live street-level view in OpenAI's neighbourhood with a slow camera drift
- the menu offers Start, a sound choice (Music + city / City only / Muted — choosing one previews it, which also satisfies autoplay rules) and About the data, plus the data status (live / cached / demo)
- Start (or Enter) flies the camera up to the neighbourhood view and the HUD animates in

These are interface states, not claims that real traffic infrastructure is being queried.

---

# 29. Error handling

If OpenRouter is unavailable:

1. Use the most recent cached dataset if available.
2. Clearly label it as stale.
3. Keep the city experience playable.
4. Never invent fresh numbers.

Example:

```text
Showing cached usage data
Last updated: Oct 1, 2026 UTC
```

If no data exists at all, show a deterministic demo mode with an explicit label:

```text
DEMO MODE — LIVE DATA UNAVAILABLE
```

Never present demo traffic as real usage.

---

# 30. API and caching strategy

Because the usage data is aggregated daily, do not request it on every page render.

Use server-side caching.

Good approach:

```text
Browser
   ↓
Next.js route
   ↓
server cache
   ↓
OpenRouter
```

Refresh the underlying data at a sensible cadence based on OpenRouter's daily aggregation.

Cache model metadata independently from rankings usage data.

Do not build a second-by-second polling loop for token usage; the source does not provide that level of freshness for this visualization.

---

# 31. Provider/model selection logic

The screenshot's navigation order can be used as the initial order:

```text
DeepSeek
OpenAI
Z.ai
Xiaomi
Tencent
NVIDIA
Gemini
Claude
Qwen
Meta
Kimi
MiniMax
Grok
Mistral
```

But availability should be data-driven.

If a provider has no relevant current model or insufficient usage data:

- hide it or mark it unavailable
- do not fabricate traffic

The default selected item can be the first available provider with meaningful current usage.

---

# 32. Model selection and usage aggregation

Because OpenRouter's rankings can treat model variants separately, the app needs explicit aggregation rules.

For V1:

- select one latest/main model per provider
- use that model's usage for its traffic corridor

Do **not** automatically sum every historical model belonging to a company unless the UI explicitly says it is showing provider-level aggregate traffic.

This keeps the product aligned with the user's requirement:

> "Whatever model is there, the latest model is enough."

If a latest alias redirects to a current concrete model, display the resolved model when available.

---

# 33. Data normalization

Usage distributions will be extremely skewed.

Never map raw token numbers directly to:

- building size
- road width
- number of vehicles
- camera distance

Use log/sigmoid/power scaling and clamp extremes.

Example conceptual normalization:

```ts
normalized = clamp(
  (Math.log10(tokens) - MIN_LOG) / (MAX_LOG - MIN_LOG),
  0,
  1
);
```

Tune the visual range based on the live distribution.

---

# 34. Important distinction: usage vs traffic

The metaphor should communicate:

```text
TOKEN USAGE = TRAFFIC VOLUME
```

It must not imply:

```text
TOKEN USAGE = NUMBER OF USERS
TOKEN USAGE = NUMBER OF REQUESTS
TOKEN USAGE = REVENUE
TOKEN USAGE = QUALITY
```

When in doubt, make the data interpretation explicit in the selected model panel.

---

# 35. What makes this product different

Do not drift into:

- generic AI dashboard
- model comparison site
- benchmark leaderboard
- chatbot
- a simulator of real Bangalore road traffic (the places are real; the traffic is AI usage)
- Token Town clone

The product's identity is:

> **An interactive 3D transportation system powered by real AI-usage telemetry.**

The city is the interface.

The traffic is the data visualization.

The dashboard is optional metadata.

---

# 36. MVP scope

Build only enough to prove the core idea.

### MVP includes

1. Full-screen 3D miniature of Bangalore
2. Roads + intersections + stylized buildings
3. Instanced moving vehicles
4. Top provider navigation from the reference image
5. Dynamic latest-model discovery
6. OpenRouter daily usage ingestion
7. Usage → vehicle density mapping
8. Growth → traffic intensification mapping
9. Click provider → camera navigates to its district
10. Selected-model metrics overlay
11. Ambient traffic audio
12. Mute control
13. 7–30 day historical scrubber
14. Data source/attribution
15. Cached fallback

### Do not build in MVP

- accounts
- profiles
- social features
- comments
- user-generated maps
- real-world maps
- live GPS
- multiplayer
- complex traffic engineering simulation
- full analytics dashboard

---

# 37. The magic moment

The key experience to optimize around:

A user opens the site.

They see dozens/hundreds of vehicles moving through a dark city.

They click **Claude**.

The camera travels through the city toward the Claude corridor.

The traffic becomes noticeably heavier.

They hear denser road ambience.

The model overlay appears:

```text
CLAUDE
Claude Sonnet ...

18.2B TOKENS
+42% THIS WEEK
```

Then they drag the timeline backward.

The traffic thins.

They move forward.

Cars begin arriving.

The corridor becomes crowded.

The user realizes:

> **"I'm watching AI demand move through a city."**

That is the product.

---

# 38. Implementation discipline

Before implementing a new feature, ask:

> Does this make the underlying AI usage more intuitive through the traffic metaphor?

If not, do not add it to V1.

Prioritize:

```text
1. Correct data
2. Strong traffic metaphor
3. Believable city movement
4. Beautiful camera navigation
5. Sound
6. Historical change
7. Secondary polish
```

Do not spend early effort on elaborate UI surrounding the scene.

---

# 39. Source references

OpenRouter usage/rankings:

- https://openrouter.ai/rankings
- https://openrouter.ai/data
- https://openrouter.ai/models
- https://openrouter.ai/docs

Conceptual visual reference:

- https://sael.net/token-town/

The Token Town project should be treated **only as a conceptual reference for the idea of physicalizing abstract AI usage**. Do not copy its assets, layout, environment, building metaphor, or implementation.

The supplied screenshot should be treated **only as a navigation/composition reference**.

---

# 40. Final acceptance criteria

The implementation is complete when:

- the page opens directly into an immersive 3D traffic world
- real OpenRouter usage data drives the visual scale of traffic
- the latest/current model for each available provider is dynamically resolved
- clicking a provider/model smoothly navigates the camera into that model's traffic district
- traffic density changes according to measured usage
- increasing/decreasing usage changes traffic behavior
- sudden spikes can create congestion events
- audio reacts to the traffic environment
- users can inspect the exact token data and period
- users can scrub historical data and visibly watch traffic change
- cached data is used when the upstream source is temporarily unavailable
- API credentials never reach the browser
- the app clearly states that the data represents OpenRouter-routed traffic, not total global AI usage
- no part of the implementation is a direct recreation of Token Town or a copied recreation of the supplied visual reference

The core result should feel like:

> **Google Maps traffic × AI telemetry × an interactive 3D miniature of Bangalore — built specifically to make model usage visible.**
