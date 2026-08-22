// Keplerian elements for the eight planets, and the maths to turn them into
// real positions.
//
// SOURCE: NASA/JPL Solar System Dynamics, "Keplerian Elements for Approximate
// Positions of the Major Planets" (Table 1, valid 1800-2050 AD).
// https://ssd.jpl.nasa.gov/planets/approx_pos.html
//
// Produced by the U.S. government and in the public domain. No attribution is
// legally required; it is here because you should always know where numbers
// came from.
//
// Each entry lists an element at the J2000 epoch and its rate of change per
// Julian century:
//   a  semi-major axis            (au,  au/century)
//   e  eccentricity               (--,  per century)
//   I  inclination                (deg, deg/century)
//   L  mean longitude             (deg, deg/century)
//   lp longitude of perihelion    (deg, deg/century)   -- JPL writes this as varpi
//   an longitude of ascending node(deg, deg/century)   -- JPL writes this as Omega

export const PLANETS = [
  { name: 'Mercury', colour: 0x9c8f86, size: 0.55,
    a: [0.38709927,  0.00000037], e: [0.20563593,  0.00001906], I: [7.00497902, -0.00594749],
    L: [252.25032350, 149472.67411175], lp: [77.45779628, 0.16047689], an: [48.33076593, -0.12534081] },

  { name: 'Venus', colour: 0xe3c99a, size: 0.85,
    a: [0.72333566,  0.00000390], e: [0.00677672, -0.00004107], I: [3.39467605, -0.00078890],
    L: [181.97909950,  58517.81538729], lp: [131.60246718, 0.00268329], an: [76.67984255, -0.27769418] },

  // JPL tabulates the Earth-Moon barycentre; at this scale it is Earth.
  { name: 'Earth', colour: 0x6fa8dc, size: 0.9,
    a: [1.00000261,  0.00000562], e: [0.01671123, -0.00004392], I: [-0.00001531, -0.01294668],
    L: [100.46457166,  35999.37244981], lp: [102.93768193, 0.32327364], an: [0.0, 0.0] },

  { name: 'Mars', colour: 0xc1633f, size: 0.7,
    a: [1.52371034,  0.00001847], e: [0.09339410,  0.00007882], I: [1.84969142, -0.00813131],
    L: [-4.55343205,  19140.30268499], lp: [-23.94362959, 0.44441088], an: [49.55953891, -0.29257343] },

  { name: 'Jupiter', colour: 0xd8a878, size: 1.9,
    a: [5.20288700, -0.00011607], e: [0.04838624, -0.00013253], I: [1.30439695, -0.00183714],
    L: [34.39644051,   3034.74612775], lp: [14.72847983, 0.21252668], an: [100.47390909, 0.20469106] },

  { name: 'Saturn', colour: 0xe0c073, size: 1.7,
    a: [9.53667594, -0.00125060], e: [0.05386179, -0.00050991], I: [2.48599187,  0.00193609],
    L: [49.95424423,   1222.49362201], lp: [92.59887831, -0.41897216], an: [113.66242448, -0.28867794] },

  { name: 'Uranus', colour: 0x8fd3d8, size: 1.35,
    a: [19.18916464, -0.00196176], e: [0.04725744, -0.00004397], I: [0.77263783, -0.00242939],
    L: [313.23810451,   428.48202785], lp: [170.95427630, 0.40805281], an: [74.01692503, 0.04240589] },

  { name: 'Neptune', colour: 0x5b7fd4, size: 1.3,
    a: [30.06992276,  0.00026291], e: [0.00859048,  0.00005105], I: [1.77004347,  0.00035372],
    L: [-55.12002969,   218.45945325], lp: [44.96476227, -0.32241464], an: [131.78422574, -0.00508664] },
];

const DEG = Math.PI / 180;

/** Julian centuries past the J2000.0 epoch for a JavaScript Date. */
export function julianCenturies(date) {
  // 2440587.5 is the Julian Date of the Unix epoch; 86400000 ms per day.
  const julianDay = date.getTime() / 86400000 + 2440587.5;
  return (julianDay - 2451545.0) / 36525;
}

/** Every element linearly propagated to time T (centuries past J2000). */
function elementsAt(planet, T) {
  return {
    a: planet.a[0] + planet.a[1] * T,
    e: planet.e[0] + planet.e[1] * T,
    I: planet.I[0] + planet.I[1] * T,
    L: planet.L[0] + planet.L[1] * T,
    lp: planet.lp[0] + planet.lp[1] * T,
    an: planet.an[0] + planet.an[1] * T,
  };
}

/** Wrap an angle in degrees to [-180, 180]. */
function wrap180(deg) {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/**
 * Solve Kepler's equation M = E - e* sin(E) for the eccentric anomaly E.
 * Angles in degrees, following JPL's formulation where e* = (180/pi) * e.
 * Newton's method; these eccentricities are small so it converges in a
 * handful of passes.
 */
function eccentricAnomaly(M, e) {
  const eStar = (180 / Math.PI) * e;
  let E = M + eStar * Math.sin(M * DEG);
  for (let i = 0; i < 12; i++) {
    const dM = M - (E - eStar * Math.sin(E * DEG));
    const dE = dM / (1 - e * Math.cos(E * DEG));
    E += dE;
    if (Math.abs(dE) < 1e-7) break;
  }
  return E;
}

/** Rotate a perifocal (orbital-plane) point into the J2000 ecliptic frame. */
function toEcliptic(el, xp, yp) {
  const omega = el.lp - el.an;              // argument of perihelion
  const cw = Math.cos(omega * DEG), sw = Math.sin(omega * DEG);
  const co = Math.cos(el.an * DEG), so = Math.sin(el.an * DEG);
  const ci = Math.cos(el.I * DEG), si = Math.sin(el.I * DEG);

  // R_z(-Omega) R_x(-I) R_z(-omega)
  return {
    x: (cw * co - sw * so * ci) * xp + (-sw * co - cw * so * ci) * yp,
    y: (cw * so + sw * co * ci) * xp + (-sw * so + cw * co * ci) * yp,
    z: (sw * si) * xp + (cw * si) * yp,
  };
}

/**
 * Heliocentric position in the J2000 ecliptic frame, in astronomical units.
 * Returns { x, y, z, r } where r is the distance from the Sun.
 */
export function heliocentric(planet, T) {
  const el = elementsAt(planet, T);
  const M = wrap180(el.L - el.lp);          // mean anomaly
  const E = eccentricAnomaly(M, el.e);

  const xp = el.a * (Math.cos(E * DEG) - el.e);
  const yp = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E * DEG);

  const p = toEcliptic(el, xp, yp);
  p.r = Math.hypot(p.x, p.y, p.z);
  return p;
}

/**
 * The full orbit as a closed loop of points, by sweeping eccentric anomaly
 * right around rather than solving Kepler's equation for each sample.
 */
export function orbitPath(planet, T, samples = 256) {
  const el = elementsAt(planet, T);
  const b = el.a * Math.sqrt(1 - el.e * el.e);
  const out = [];
  for (let i = 0; i < samples; i++) {
    const E = (i / samples) * 360;
    const xp = el.a * (Math.cos(E * DEG) - el.e);
    const yp = b * Math.sin(E * DEG);
    out.push(toEcliptic(el, xp, yp));
  }
  return out;
}

/** Orbital period in Julian years, from Kepler's third law. */
export function periodYears(planet) {
  return Math.sqrt(planet.a[0] ** 3);
}
