// Real Bangalore geography, simplified into a miniature. Coordinates are approximate WGS84.
// Provider → neighbourhood assignments are labels only: the traffic shown is AI token usage,
// not real Bangalore traffic.

export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export const CENTER = { lat: 12.9716, lon: 77.5946 };

/** Neighbourhoods that host a provider's traffic district. */
export const DISTRICT_PLACES: Place[] = [
  { id: 'silkboard', name: 'Silk Board', lat: 12.9177, lon: 77.6238 },
  { id: 'mgroad', name: 'MG Road', lat: 12.9756, lon: 77.6066 },
  { id: 'banashankari', name: 'Banashankari', lat: 12.9255, lon: 77.5468 },
  { id: 'yeshwanthpur', name: 'Yeshwanthpur', lat: 13.028, lon: 77.5409 },
  { id: 'malleshwaram', name: 'Malleshwaram', lat: 13.0035, lon: 77.571 },
  { id: 'ecity', name: 'Electronic City', lat: 12.8452, lon: 77.6602 },
  { id: 'whitefield', name: 'Whitefield', lat: 12.9698, lon: 77.75 },
  { id: 'koramangala', name: 'Koramangala', lat: 12.9352, lon: 77.6245 },
  { id: 'hebbal', name: 'Hebbal', lat: 13.0358, lon: 77.597 },
  { id: 'indiranagar', name: 'Indiranagar', lat: 12.9784, lon: 77.6408 },
  { id: 'jayanagar', name: 'Jayanagar', lat: 12.925, lon: 77.5938 },
  { id: 'yelahanka', name: 'Yelahanka', lat: 13.1005, lon: 77.5963 },
  { id: 'majestic', name: 'Majestic', lat: 12.9767, lon: 77.5713 },
  { id: 'marathahalli', name: 'Marathahalli', lat: 12.9569, lon: 77.7011 },
];

/** provider key → district place id. Edit freely; it only changes where a corridor sits. */
export const PROVIDER_PLACE: Record<string, string> = {
  deepseek: 'silkboard',
  openai: 'mgroad',
  zai: 'banashankari',
  xiaomi: 'yeshwanthpur',
  tencent: 'malleshwaram',
  nvidia: 'ecity',
  google: 'whitefield',
  anthropic: 'koramangala',
  qwen: 'hebbal',
  meta: 'indiranagar',
  moonshotai: 'jayanagar',
  minimax: 'yelahanka',
  'x-ai': 'majestic',
  mistral: 'marathahalli',
};

/** Smaller neighbourhood labels so the whole city reads as Bangalore. */
export const AMBIENT_PLACES: Place[] = [
  { id: 'hsr', name: 'HSR Layout', lat: 12.9116, lon: 77.6474 },
  { id: 'btm', name: 'BTM Layout', lat: 12.9166, lon: 77.6101 },
  { id: 'bellandur', name: 'Bellandur', lat: 12.926, lon: 77.6762 },
  { id: 'domlur', name: 'Domlur', lat: 12.9609, lon: 77.6387 },
  { id: 'krpuram', name: 'KR Puram', lat: 13.005, lon: 77.695 },
  { id: 'rajajinagar', name: 'Rajajinagar', lat: 12.991, lon: 77.5525 },
  { id: 'basavanagudi', name: 'Basavanagudi', lat: 12.9406, lon: 77.5738 },
  { id: 'shivajinagar', name: 'Shivajinagar', lat: 12.9857, lon: 77.6057 },
  { id: 'rtnagar', name: 'RT Nagar', lat: 13.0213, lon: 77.5946 },
  { id: 'jpnagar', name: 'JP Nagar', lat: 12.9063, lon: 77.5857 },
  { id: 'frazertown', name: 'Frazer Town', lat: 12.9967, lon: 77.6146 },
  { id: 'kengeri', name: 'Kengeri', lat: 12.9077, lon: 77.4826 },
  { id: 'peenya', name: 'Peenya', lat: 13.0285, lon: 77.5197 },
  { id: 'hennur', name: 'Hennur', lat: 13.0358, lon: 77.643 },
  { id: 'sarjapur', name: 'Sarjapur Road', lat: 12.91, lon: 77.686 },
  { id: 'bannerghatta', name: 'Bannerghatta Road', lat: 12.888, lon: 77.597 },
  { id: 'vijayanagar', name: 'Vijayanagar', lat: 12.9719, lon: 77.5352 },
  { id: 'banaswadi', name: 'Banaswadi', lat: 13.0104, lon: 77.6482 },
  { id: 'manyata', name: 'Manyata Tech Park', lat: 13.0475, lon: 77.6215 },
  { id: 'kammanahalli', name: 'Kammanahalli', lat: 13.0157, lon: 77.638 },
  { id: 'hoodi', name: 'Hoodi', lat: 12.995, lon: 77.715 },
  { id: 'bommanahalli', name: 'Bommanahalli', lat: 12.9, lon: 77.63 },
];

export type Waypoint = { place: string } | { lat: number; lon: number };

export interface RouteDef {
  id: string;
  name: string;
  kind: 'arterial' | 'ring';
  lanes: number;
  waypoints: Waypoint[];
  /** Grade-separated stretches: around one place, or between two places on the route. */
  elevated?: { from: string; to?: string; radius?: number }[];
}

export const ROUTES: RouteDef[] = [
  {
    id: 'orr',
    name: 'Outer Ring Road',
    kind: 'ring',
    lanes: 3,
    waypoints: [
      { place: 'hebbal' },
      { lat: 13.041, lon: 77.62 },
      { lat: 13.034, lon: 77.644 },
      { lat: 13.006, lon: 77.69 },
      { place: 'marathahalli' },
      { lat: 12.93, lon: 77.678 },
      { lat: 12.92, lon: 77.65 },
      { place: 'silkboard' },
      { lat: 12.915, lon: 77.605 },
      { lat: 12.906, lon: 77.578 },
      { lat: 12.911, lon: 77.54 },
      { lat: 12.945, lon: 77.515 },
      { lat: 12.97, lon: 77.512 },
      { lat: 12.995, lon: 77.515 },
      { place: 'yeshwanthpur' },
      { lat: 13.045, lon: 77.56 },
    ],
  },
  {
    id: 'bellary-hosur',
    name: 'Bellary Road – Hosur Road',
    kind: 'arterial',
    lanes: 2,
    waypoints: [
      { lat: 13.17, lon: 77.6 },
      { place: 'yelahanka' },
      { place: 'hebbal' },
      { lat: 13.014, lon: 77.584 },
      { place: 'mgroad' },
      { lat: 12.955, lon: 77.615 },
      { place: 'koramangala' },
      { place: 'silkboard' },
      { lat: 12.9, lon: 77.63 },
      { place: 'ecity' },
      { lat: 12.78, lon: 77.68 },
    ],
    // Hebbal flyover; Silk Board flyover running into the Electronic City elevated expressway.
    elevated: [{ from: 'hebbal', radius: 120 }, { from: 'silkboard', to: 'ecity' }],
  },
  {
    id: 'tumkur-oldmadras',
    name: 'Tumkur Road – Old Madras Road',
    kind: 'arterial',
    lanes: 2,
    waypoints: [
      { lat: 13.085, lon: 77.465 },
      { lat: 13.0285, lon: 77.5197 },
      { place: 'yeshwanthpur' },
      { place: 'malleshwaram' },
      { place: 'majestic' },
      { place: 'mgroad' },
      { place: 'indiranagar' },
      { lat: 13.006, lon: 77.69 },
      { lat: 13.03, lon: 77.775 },
    ],
    elevated: [{ from: 'yeshwanthpur', radius: 110 }],
  },
  {
    id: 'kanakapura-whitefield',
    name: 'Kanakapura Road – Old Airport Road – Whitefield',
    kind: 'arterial',
    lanes: 2,
    waypoints: [
      { lat: 12.84, lon: 77.5 },
      { place: 'banashankari' },
      { place: 'jayanagar' },
      { place: 'koramangala' },
      { lat: 12.9609, lon: 77.6387 },
      { lat: 12.958, lon: 77.668 },
      { place: 'marathahalli' },
      { place: 'whitefield' },
      { lat: 12.97, lon: 77.83 },
    ],
  },
];

export interface MetroLineDef {
  id: string;
  name: string;
  color: string;
  waypoints: Waypoint[];
  stations: string[];
}

export const METRO: MetroLineDef[] = [
  {
    id: 'purple',
    name: 'Purple Line',
    color: '#8e4fc6',
    waypoints: [
      { place: 'whitefield' },
      { lat: 12.995, lon: 77.715 },
      { lat: 13.0, lon: 77.68 },
      { lat: 12.9907, lon: 77.6522 },
      { place: 'indiranagar' },
      { place: 'mgroad' },
      { lat: 12.9796, lon: 77.5907 },
      { place: 'majestic' },
      { lat: 12.9719, lon: 77.5352 },
      { lat: 12.946, lon: 77.53 },
      { lat: 12.9077, lon: 77.4826 },
    ],
    stations: ['whitefield', 'indiranagar', 'mgroad', 'majestic'],
  },
  {
    id: 'green',
    name: 'Green Line',
    color: '#3faa4f',
    waypoints: [
      { lat: 13.048, lon: 77.5 },
      { lat: 13.0285, lon: 77.5197 },
      { place: 'yeshwanthpur' },
      { place: 'malleshwaram' },
      { place: 'majestic' },
      { lat: 12.95, lon: 77.578 },
      { place: 'jayanagar' },
      { lat: 12.9063, lon: 77.5857 },
      { lat: 12.862, lon: 77.53 },
    ],
    stations: ['yeshwanthpur', 'malleshwaram', 'majestic', 'jayanagar'],
  },
  {
    id: 'yellow',
    name: 'Yellow Line',
    color: '#f1c232',
    waypoints: [
      { lat: 12.9213, lon: 77.58 },
      { place: 'silkboard' },
      { lat: 12.9, lon: 77.632 },
      { place: 'ecity' },
      { lat: 12.815, lon: 77.695 },
    ],
    stations: ['silkboard', 'ecity'],
  },
];

export type LandmarkKind = 'vidhana-soudha' | 'palace' | 'glasshouse' | 'stadium' | 'tower' | 'park' | 'lake';

export interface LandmarkDef {
  id: string;
  name: string;
  kind: LandmarkKind;
  lat: number;
  lon: number;
  /** Footprint radius in metres (scene units at 1 km = KM). */
  size: number;
}

export const LANDMARKS: LandmarkDef[] = [
  { id: 'cubbon', name: 'Cubbon Park', kind: 'park', lat: 12.9763, lon: 77.5929, size: 70 },
  { id: 'vidhana', name: 'Vidhana Soudha', kind: 'vidhana-soudha', lat: 12.9796, lon: 77.5907, size: 40 },
  { id: 'lalbagh', name: 'Lalbagh', kind: 'park', lat: 12.9507, lon: 77.5848, size: 75 },
  { id: 'glasshouse', name: 'Lalbagh Glass House', kind: 'glasshouse', lat: 12.9507, lon: 77.5848, size: 18 },
  { id: 'palace', name: 'Bangalore Palace', kind: 'palace', lat: 12.9987, lon: 77.592, size: 34 },
  { id: 'stadium', name: 'Chinnaswamy Stadium', kind: 'stadium', lat: 12.9788, lon: 77.5996, size: 32 },
  { id: 'ubcity', name: 'UB City', kind: 'tower', lat: 12.9716, lon: 77.596, size: 14 },
  { id: 'ulsoor', name: 'Ulsoor Lake', kind: 'lake', lat: 12.983, lon: 77.62, size: 45 },
  { id: 'bellandur-lake', name: 'Bellandur Lake', kind: 'lake', lat: 12.935, lon: 77.668, size: 95 },
  { id: 'hebbal-lake', name: 'Hebbal Lake', kind: 'lake', lat: 13.046, lon: 77.585, size: 50 },
  { id: 'sankey', name: 'Sankey Tank', kind: 'lake', lat: 13.009, lon: 77.574, size: 32 },
  { id: 'agara', name: 'Agara Lake', kind: 'lake', lat: 12.9235, lon: 77.6405, size: 40 },
  { id: 'varthur', name: 'Varthur Lake', kind: 'lake', lat: 12.945, lon: 77.735, size: 70 },
];

/** Scene units per kilometre. */
export const KM = 90;

/** lat/lon → scene x (east) / z (south). */
export function project(lat: number, lon: number): { x: number; z: number } {
  const kx = 111.32 * Math.cos((CENTER.lat * Math.PI) / 180);
  return { x: (lon - CENTER.lon) * kx * KM, z: -(lat - CENTER.lat) * 110.57 * KM };
}

export const placeById = (id: string) => DISTRICT_PLACES.find((p) => p.id === id) ?? AMBIENT_PLACES.find((p) => p.id === id);
