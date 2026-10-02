// Visual + simulation constants. Vehicle counts are a log-compressed VISUAL scale derived from
// token volume — one vehicle is not a fixed number of tokens, users or requests.

export const TRAFFIC_SCALE = {
  /** Fraction of a lane's jam capacity filled at the lowest / highest observed usage. */
  minFill: 0.03,
  maxFill: 0.36,
  /** Exponent applied to normalized activity before mapping to fill (>1 = emphasize the top). */
  activityCurve: 1.15,
  /** Extra density from week-over-week growth (growthNormalized is -1..1). */
  growthBoost: 0.3,
  /** Extra density while a corridor is jammed by a usage spike. */
  jamBoost: 0.14,
  /** Bumper-to-bumper spacing used to compute lane capacity (m). */
  jamSpacing: 6.5,
};

export const LAYOUT = {
  laneWidth: 3.3,
  median: 1.4,
  loopLanes: 3,
  /** Minimum distance between neighbourhood centres after nudging apart. */
  districtSpacing: 235,
  elevatedHeight: 8,
  metroHeight: 15,
};

export const SPEEDS = {
  loop: 12.5,
  arterial: 14,
  ring: 15,
};

export interface QualityProfile {
  mobile: boolean;
  maxVehicles: number;
  vehicleScale: number;
  pixelRatio: number;
  buildingDensity: number;
  treeBudget: number;
  pedestrians: number;
  antialias: boolean;
  shadows: boolean;
  postprocess: boolean;
}

export function qualityProfile(): QualityProfile {
  const forced = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('quality') : null;
  const mobile = typeof window !== 'undefined' && (window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 720);
  const ratio = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  // `?quality=low|medium|high` overrides the automatic choice for weaker or stronger GPUs.
  if (forced === 'low' || (mobile && forced !== 'medium' && forced !== 'high')) {
    return { mobile: true, maxVehicles: 1600, vehicleScale: 0.45, pixelRatio: Math.min(ratio, 1.5), buildingDensity: 0.5, treeBudget: 1800, pedestrians: 200, antialias: false, shadows: false, postprocess: false };
  }
  if (forced === 'medium') {
    return { mobile: false, maxVehicles: 3600, vehicleScale: 0.75, pixelRatio: Math.min(ratio, 1.5), buildingDensity: 0.8, treeBudget: 3500, pedestrians: 450, antialias: true, shadows: false, postprocess: true };
  }
  return { mobile: false, maxVehicles: 6000, vehicleScale: 1, pixelRatio: Math.min(ratio, 2), buildingDensity: 1, treeBudget: 5500, pedestrians: 700, antialias: true, shadows: true, postprocess: true };
}
