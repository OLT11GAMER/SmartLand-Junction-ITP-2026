#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import * as turf from '@turf/turf';
import { Delaunay } from 'd3-delaunay';

const KOSOVO_BOUNDS = [19.85, 41.82, 21.95, 43.32];
const DEFAULT_SEED = 918273;

const DISTRICTS = [
  { name: 'Prizren', abbr: 'PRZ', center: [20.739, 42.214] },
  { name: 'Pristina', abbr: 'PRT', center: [21.165, 42.662] },
  { name: 'Peja', abbr: 'PEJ', center: [20.292, 42.660] },
  { name: 'Gjakova', abbr: 'GJK', center: [20.430, 42.381] },
  { name: 'Ferizaj', abbr: 'FRZ', center: [21.146, 42.370] },
  { name: 'Gjilan', abbr: 'GJN', center: [21.466, 42.463] },
  { name: 'Mitrovica', abbr: 'MIT', center: [20.867, 42.891] },
  { name: 'Rahovec', abbr: 'RAH', center: [20.650, 42.371] },
  { name: 'Suhareka', abbr: 'SUH', center: [20.825, 42.355] },
  { name: 'Podujeva', abbr: 'PDJ', center: [21.192, 42.911] },
  { name: 'Lipjan', abbr: 'LPJ', center: [21.138, 42.530] },
  { name: 'Malisheva', abbr: 'MLS', center: [20.745, 42.482] }
];

const CROPS = ['wheat', 'corn', 'barley', 'potato', 'beans', 'vegetables', 'orchard', 'vineyard', 'pasture'];

function parseArgs(argv) {
  const args = {
    seed: DEFAULT_SEED,
    mode: 'grid',
    targetParcels: 720,
    border: null,
    farmlandMask: null,
    densityMask: null,
    healthMask: null,
    cropTypeMask: null,
    outDir: 'data'
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => argv[++i];
    if (token === '--seed') args.seed = Number(next());
    else if (token === '--mode') args.mode = next();
    else if (token === '--target-parcels') args.targetParcels = Number(next());
    else if (token === '--border') args.border = next();
    else if (token === '--farmland-mask') args.farmlandMask = next();
    else if (token === '--density-mask') args.densityMask = next();
    else if (token === '--health-mask') args.healthMask = next();
    else if (token === '--crop-type-mask') args.cropTypeMask = next();
    else if (token === '--out-dir') args.outDir = next();
  }

  return args;
}

function createRng(seed) {
  let t = seed >>> 0;
  return function rng() {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function weightedChoice(options, rng) {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return options[0][0];
  let pick = rng() * total;
  for (const [item, weight] of options) {
    pick -= weight;
    if (pick <= 0) return item;
  }
  return options[options.length - 1][0];
}

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function cloneCoords(coords) {
  return JSON.parse(JSON.stringify(coords));
}

function mapCoords(coords, fn) {
  if (typeof coords[0] === 'number') return fn(coords);
  return coords.map((child) => mapCoords(child, fn));
}

function pickLargestPolygonCoordinates(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type !== 'MultiPolygon') return null;
  let best = null;
  let bestArea = -1;
  for (const polygon of geometry.coordinates) {
    const area = ringArea(polygon[0]);
    if (area > bestArea) {
      bestArea = area;
      best = polygon;
    }
  }
  return best;
}

function localRingToGeoRing(ring) {
  const [minLon, minLat, maxLon, maxLat] = KOSOVO_BOUNDS;
  return ring.map(([x, y]) => [
    minLon + x * (maxLon - minLon),
    maxLat - y * (maxLat - minLat)
  ]);
}

function localPointToGeo(point) {
  return localRingToGeoRing([point])[0];
}

function geoAreaHaFromRing(ring) {
  const feature = turf.polygon([ring]);
  return Math.round((turf.area(feature) / 10000) * 100) / 100;
}

function loadPngMask(filePath) {
  if (!filePath) return null;
  if (!fs.existsSync(filePath)) return null;
  const png = PNG.sync.read(fs.readFileSync(filePath));
  return { data: png.data, width: png.width, height: png.height };
}

function proceduralMask(name, x, y, seed) {
  const base = (Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0) * 0.0017) + seed * 0.00013;
  let value = 0.5;
  value += 0.24 * Math.sin((x + base) * 12.6) * Math.cos((y - base) * 9.8);
  value += 0.14 * Math.sin((x * 3.3 + y * 2.1 + base) * 7.4);
  value += 0.08 * Math.cos((x - y + base) * 14.0);
  return clamp(value, 0, 1);
}

function sampleMask(mask, name, x, y, seed) {
  if (!mask) return proceduralMask(name, x, y, seed);
  const px = clamp(x, 0, 1) * (mask.width - 1);
  const py = clamp(y, 0, 1) * (mask.height - 1);
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, mask.width - 1);
  const y1 = Math.min(y0 + 1, mask.height - 1);
  const tx = px - x0;
  const ty = py - y0;
  const idx = (yy, xx) => (yy * mask.width + xx) * 4;
  const sample = (xx, yy) => mask.data[idx(yy, xx)];
  const top = sample(x0, y0) * (1 - tx) + sample(x1, y0) * tx;
  const bottom = sample(x0, y1) * (1 - tx) + sample(x1, y1) * tx;
  return ((top * (1 - ty) + bottom * ty) / 255);
}

function parsePointsAttribute(value) {
  const matches = value.trim().match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  const nums = matches.map(Number);
  const points = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    points.push([nums[i], nums[i + 1]]);
  }
  return points;
}

function parseSimplePath(d) {
  const tokens = d.match(/[MmLlHhVvZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const points = [];
  let i = 0;
  let command = null;
  let current = [0, 0];
  let start = null;

  function readNumber() {
    if (i >= tokens.length) throw new Error('Unexpected end of SVG path.');
    return Number(tokens[i += 1 - 1]) || Number(tokens[i - 1]);
  }

  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[MmLlHhVvZz]$/.test(token)) {
      command = token;
      i += 1;
      if (command === 'Z' || command === 'z') {
        if (start) points.push(start);
        continue;
      }
    }

    if (command === 'M' || command === 'm') {
      const x = Number(tokens[i++]);
      const y = Number(tokens[i++]);
      current = command === 'm' ? [current[0] + x, current[1] + y] : [x, y];
      start = current;
      points.push(current);
      command = command === 'M' ? 'L' : 'l';
    } else if (command === 'L' || command === 'l') {
      const x = Number(tokens[i++]);
      const y = Number(tokens[i++]);
      current = command === 'l' ? [current[0] + x, current[1] + y] : [x, y];
      points.push(current);
    } else if (command === 'H' || command === 'h') {
      const x = Number(tokens[i++]);
      current = command === 'h' ? [current[0] + x, current[1]] : [x, current[1]];
      points.push(current);
    } else if (command === 'V' || command === 'v') {
      const y = Number(tokens[i++]);
      current = command === 'v' ? [current[0], current[1] + y] : [current[0], y];
      points.push(current);
    } else {
      throw new Error('SVG path contains unsupported commands. Convert it to polygon points or GeoJSON first.');
    }
  }

  return points;
}

function defaultBorderGeometry() {
  return {
    type: 'Polygon',
    coordinates: [[
      [0.12, 0.16],
      [0.19, 0.08],
      [0.31, 0.06],
      [0.40, 0.10],
      [0.53, 0.05],
      [0.66, 0.11],
      [0.80, 0.18],
      [0.87, 0.31],
      [0.83, 0.47],
      [0.88, 0.63],
      [0.82, 0.78],
      [0.70, 0.88],
      [0.57, 0.92],
      [0.43, 0.87],
      [0.31, 0.91],
      [0.20, 0.84],
      [0.12, 0.70],
      [0.08, 0.53],
      [0.10, 0.34],
      [0.12, 0.16]
    ]]
  };
}

function parseSvgGeometry(svgText) {
  const polygonMatch = svgText.match(/<polygon[^>]*points="([^"]+)"/i);
  if (polygonMatch) {
    return { type: 'Polygon', coordinates: [parsePointsAttribute(polygonMatch[1])] };
  }

  const polylineMatch = svgText.match(/<polyline[^>]*points="([^"]+)"/i);
  if (polylineMatch) {
    const points = parsePointsAttribute(polylineMatch[1]);
    if (points.length && (points[0][0] !== points[points.length - 1][0] || points[0][1] !== points[points.length - 1][1])) {
      points.push([...points[0]]);
    }
    return { type: 'Polygon', coordinates: [points] };
  }

  const pathMatch = svgText.match(/<path[^>]*d="([^"]+)"/i);
  if (pathMatch) {
    const points = parseSimplePath(pathMatch[1]);
    if (points.length && (points[0][0] !== points[points.length - 1][0] || points[0][1] !== points[points.length - 1][1])) {
      points.push([...points[0]]);
    }
    return { type: 'Polygon', coordinates: [points] };
  }

  throw new Error('SVG border did not contain polygon, polyline, or path data.');
}

function normalizeGeometryToUnit(geometry) {
  const bbox = turf.bbox(geometry);
  const [minX, minY, maxX, maxY] = bbox;
  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) throw new Error('Invalid border bounds.');

  const normalize = ([x, y]) => [(x - minX) / width, (y - minY) / height];
  const normalized = {
    type: geometry.type,
    coordinates: mapCoords(geometry.coordinates, normalize)
  };
  return normalized;
}

function chooseLargestPolygon(geometry) {
  const coords = pickLargestPolygonCoordinates(geometry);
  if (!coords) return null;
  return {
    type: 'Polygon',
    coordinates: cloneCoords(coords)
  };
}

function loadBorderGeometry(borderPath) {
  if (!borderPath || !fs.existsSync(borderPath)) {
    return defaultBorderGeometry();
  }

  const ext = path.extname(borderPath).toLowerCase();
  if (ext === '.svg') {
    const svg = fs.readFileSync(borderPath, 'utf8');
    return normalizeGeometryToUnit(parseSvgGeometry(svg));
  }

  if (ext === '.json' || ext === '.geojson') {
    const data = JSON.parse(fs.readFileSync(borderPath, 'utf8'));
    let geometry = null;
    if (data.type === 'FeatureCollection') {
      const features = data.features.filter((feature) => feature && feature.geometry);
      if (!features.length) throw new Error('GeoJSON border file has no geometries.');
      let best = features[0];
      let bestArea = turf.area(best);
      for (const feature of features.slice(1)) {
        const area = turf.area(feature);
        if (area > bestArea) {
          best = feature;
          bestArea = area;
        }
      }
      geometry = best.geometry;
    } else if (data.type === 'Feature') {
      geometry = data.geometry;
    } else if (data.type) {
      geometry = data;
    }
    if (!geometry) throw new Error('Unsupported GeoJSON border input.');
    const largest = chooseLargestPolygon(geometry);
    if (!largest) throw new Error('Border geometry was not a polygon.');
    return normalizeGeometryToUnit(largest);
  }

  throw new Error(`Unsupported border format: ${borderPath}`);
}

function convertGridToCells(rows, cols) {
  const xEdges = Array.from({ length: cols + 1 }, (_, index) => index / cols);
  const yEdges = Array.from({ length: rows + 1 }, (_, index) => index / rows);
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push({
        x0: xEdges[col],
        y0: yEdges[row],
        x1: xEdges[col + 1],
        y1: yEdges[row + 1],
        kind: 'grid'
      });
    }
  }
  return cells;
}

function splitCell(cell, farmland, density, rng) {
  if (cell.x1 - cell.x0 < 0.03 || cell.y1 - cell.y0 < 0.03) return [cell];

  const splitScore = 0.18 + density * 0.45 + farmland * 0.22 + rng() * 0.12;
  if (splitScore < 0.58) return [cell];

  const ratio = 0.4 + rng() * 0.2;
  if (splitScore > 0.79) {
    const splitX = cell.x0 + (cell.x1 - cell.x0) * ratio;
    const splitY = cell.y0 + (cell.y1 - cell.y0) * (0.4 + rng() * 0.2);
    return [
      { x0: cell.x0, y0: cell.y0, x1: splitX, y1: splitY, kind: 'grid' },
      { x0: splitX, y0: cell.y0, x1: cell.x1, y1: splitY, kind: 'grid' },
      { x0: cell.x0, y0: splitY, x1: splitX, y1: cell.y1, kind: 'grid' },
      { x0: splitX, y0: splitY, x1: cell.x1, y1: cell.y1, kind: 'grid' }
    ];
  }

  if ((cell.x1 - cell.x0) >= (cell.y1 - cell.y0)) {
    const splitX = cell.x0 + (cell.x1 - cell.x0) * ratio;
    return [
      { x0: cell.x0, y0: cell.y0, x1: splitX, y1: cell.y1, kind: 'grid' },
      { x0: splitX, y0: cell.y0, x1: cell.x1, y1: cell.y1, kind: 'grid' }
    ];
  }

  const splitY = cell.y0 + (cell.y1 - cell.y0) * ratio;
  return [
    { x0: cell.x0, y0: cell.y0, x1: cell.x1, y1: splitY, kind: 'grid' },
    { x0: cell.x0, y0: splitY, x1: cell.x1, y1: cell.y1, kind: 'grid' }
  ];
}

function buildGridCells(targetParcels, masks, rng) {
  const cols = Math.max(14, Math.round(Math.sqrt(targetParcels * 1.25)));
  const rows = Math.max(10, Math.round(targetParcels / cols));
  const cells = convertGridToCells(rows, cols);
  const result = [];
  for (const cell of cells) {
    const cx = (cell.x0 + cell.x1) / 2;
    const cy = (cell.y0 + cell.y1) / 2;
    const farmland = sampleMask(masks.farmland, 'farmland', cx, cy, 0);
    const density = sampleMask(masks.density, 'density', cx, cy, 0);
    result.push(...splitCell(cell, farmland, density, rng));
  }
  return result;
}

function buildVoronoiCells(targetParcels, rng) {
  const cols = Math.max(14, Math.round(Math.sqrt(targetParcels * 1.25)));
  const rows = Math.max(10, Math.round(targetParcels / cols));
  const points = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = (col + 0.5) / cols;
      const y = (row + 0.5) / rows;
      const jitterX = (rng() - 0.5) * (1 / cols) * 0.32;
      const jitterY = (rng() - 0.5) * (1 / rows) * 0.32;
      points.push([
        clamp(x + jitterX, 0.01, 0.99),
        clamp(y + jitterY, 0.01, 0.99)
      ]);
    }
  }

  const delaunay = Delaunay.from(points);
  const voronoi = delaunay.voronoi([0, 0, 1, 1]);
  const cells = [];
  for (let i = 0; i < points.length; i += 1) {
    const ring = voronoi.cellPolygon(i);
    if (!ring || ring.length < 4) continue;
    cells.push({ x0: 0, y0: 0, x1: 1, y1: 1, kind: 'voronoi', ring });
  }
  return cells;
}

function districtForPoint(lon, lat) {
  let best = DISTRICTS[0];
  let bestDistance = Infinity;
  for (const district of DISTRICTS) {
    const dx = lon - district.center[0];
    const dy = lat - district.center[1];
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      best = district;
      bestDistance = distance;
    }
  }
  return best;
}

function cropBiasForDistrict(name) {
  return {
    Prizren: { vineyard: 1.45, orchard: 1.15, vegetables: 1.1, wheat: 1.05 },
    Rahovec: { vineyard: 1.75, orchard: 1.25, wheat: 0.95 },
    Suhareka: { wheat: 1.2, corn: 1.1, orchard: 1.05 },
    Pristina: { wheat: 1.25, corn: 1.2, vegetables: 1.15 },
    Peja: { pasture: 1.2, orchard: 1.12, beans: 1.05 },
    Gjakova: { wheat: 1.2, corn: 1.15, vegetables: 1.05 },
    Ferizaj: { corn: 1.2, wheat: 1.15, beans: 1.05 },
    Gjilan: { corn: 1.1, wheat: 1.1, orchard: 1.05 },
    Mitrovica: { pasture: 1.25, wheat: 1.05, barley: 1.05 },
    Podujeva: { wheat: 1.2, barley: 1.15, pasture: 1.05 },
    Lipjan: { vegetables: 1.18, wheat: 1.12, corn: 1.08 },
    Malisheva: { wheat: 1.1, vineyard: 1.05, pasture: 1.05 }
  }[name] || {};
}

function chooseCropType(isFarmland, districtName, cropMask, rng) {
  if (!isFarmland) {
    return weightedChoice([
      ['pasture', 0.6],
      ['fallow', 0.25],
      ['mixed', 0.15]
    ], rng);
  }

  const bias = cropBiasForDistrict(districtName);
  const weights = CROPS.map((crop) => {
    let weight = 1;
    weight *= bias[crop] || 1;
    if (crop === 'vineyard') weight *= 0.7 + cropMask * 1.4;
    else if (crop === 'orchard') weight *= 0.8 + cropMask * 1.1;
    else if (crop === 'vegetables') weight *= 0.75 + cropMask * 1.0;
    else if (crop === 'wheat' || crop === 'barley' || crop === 'corn') weight *= 0.9 + (1 - Math.abs(cropMask - 0.55)) * 0.8;
    else if (crop === 'pasture') weight *= 0.65 + (1 - cropMask) * 0.8;
    return [crop, weight];
  });
  return weightedChoice(weights, rng);
}

function chooseLandUse(isFarmland, farmlandMask, densityMask, slopeRisk, rng) {
  if (isFarmland) {
    return weightedChoice([
      ['farmland', 0.55 + farmlandMask * 0.6],
      ['orchard', 0.12 + farmlandMask * 0.2],
      ['vineyard', 0.12 + farmlandMask * 0.18],
      ['mixed', 0.10 + densityMask * 0.08],
      ['fallow', 0.06 + (1 - farmlandMask) * 0.08]
    ], rng);
  }

  return weightedChoice([
    ['pasture', 0.35 + densityMask * 0.12],
    ['fallow', 0.24 + (slopeRisk / 100) * 0.18],
    ['forest_edge', 0.24 + (1 - farmlandMask) * 0.15],
    ['mixed', 0.17 + densityMask * 0.1]
  ], rng);
}

function transformLocalGeometryToGeo(geometry) {
  if (geometry.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geometry.coordinates.map((ring) => ring.map(localPointToGeo))
    };
  }

  if (geometry.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geometry.coordinates.map((polygon) => polygon.map((ring) => ring.map(localPointToGeo)))
    };
  }

  throw new Error(`Unsupported geometry type: ${geometry.type}`);
}

function featureFromGeometry(geometry) {
  return { type: 'Feature', properties: {}, geometry };
}

function clipToBorder(localFeature, borderFeature) {
  const clipped = turf.intersect(turf.featureCollection([localFeature, borderFeature]));
  if (!clipped) return null;
  if (clipped.geometry.type === 'Polygon') return clipped;
  if (clipped.geometry.type !== 'MultiPolygon') return null;

  let best = null;
  let bestArea = -1;
  for (const polygon of clipped.geometry.coordinates) {
    const polygonFeature = turf.polygon([polygon[0]]);
    const area = ringArea(polygon[0]);
    if (area > bestArea) {
      bestArea = area;
      best = polygonFeature;
    }
  }
  return best;
}

function sampleMaskBundle(masks, x, y, seed) {
  return {
    farmland: round(sampleMask(masks.farmland, 'farmland', x, y, seed)),
    density: round(sampleMask(masks.density, 'density', x, y, seed)),
    health: round(sampleMask(masks.health, 'health', x, y, seed)),
    cropType: round(sampleMask(masks.cropType, 'cropType', x, y, seed))
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function buildFeature(index, cell, localFeature, masks, seed, rng, mode) {
  const centroid = turf.centroid(localFeature).geometry.coordinates;
  const [cx, cy] = centroid;
  const samples = [
    sampleMaskBundle(masks, cx, cy, seed + index),
    sampleMaskBundle(masks, clamp(cx - 0.08, 0, 1), cy, seed + index + 1),
    sampleMaskBundle(masks, clamp(cx + 0.08, 0, 1), cy, seed + index + 2),
    sampleMaskBundle(masks, cx, clamp(cy - 0.08, 0, 1), seed + index + 3),
    sampleMaskBundle(masks, cx, clamp(cy + 0.08, 0, 1), seed + index + 4),
    sampleMaskBundle(masks, clamp(cx - 0.05, 0, 1), clamp(cy - 0.05, 0, 1), seed + index + 5),
    sampleMaskBundle(masks, clamp(cx + 0.05, 0, 1), clamp(cy + 0.05, 0, 1), seed + index + 6)
  ];

  const farmlandMask = samples.reduce((sum, sample) => sum + sample.farmland, 0) / samples.length;
  const densityMask = samples.reduce((sum, sample) => sum + sample.density, 0) / samples.length;
  const healthMask = samples.reduce((sum, sample) => sum + sample.health, 0) / samples.length;
  const cropMask = samples.reduce((sum, sample) => sum + sample.cropType, 0) / samples.length;

  const geoCentroid = localPointToGeo([cx, cy]);
  const district = districtForPoint(geoCentroid[0], geoCentroid[1]);
  const farmlandProbability = clamp(0.15 + farmlandMask * 0.70 + densityMask * 0.15, 0.03, 0.97);
  const isFarmland = rng() < farmlandProbability;

  const slopeNoise = proceduralMask('slope', cx, cy, seed + 17);
  const waterNoise = proceduralMask('water', cx, cy, seed + 31);
  const soilNoise = proceduralMask('soil', cx, cy, seed + 47);

  const slopeRisk = Math.round(clamp((1 - farmlandMask * 0.55 - densityMask * 0.15 + slopeNoise * 0.6) * 100, 0, 100));
  const waterAccess = Math.round(clamp((densityMask * 0.55 + healthMask * 0.25 + waterNoise * 0.20) * 100, 0, 100));
  const soilQuality = Math.round(clamp((farmlandMask * 0.45 + healthMask * 0.25 + soilNoise * 0.30) * 100, 0, 100));

  const cropType = chooseCropType(isFarmland, district.name, cropMask, rng);
  const landUse = chooseLandUse(isFarmland, farmlandMask, densityMask, slopeRisk, rng);
  const cropSuitability = clamp((cropMask * 0.6 + farmlandMask * 0.4) * 100, 0, 100);
  const farmScore = Math.round(clamp(farmlandMask * 55 + cropSuitability * 0.25 + waterAccess * 0.1 + rng() * 10, 0, 100));
  const harvestHealth = Math.round(clamp(20 + healthMask * 60 + waterAccess * 0.15 - slopeRisk * 0.25 + rng() * 10, 0, 100));

  const localArea = ringArea(localFeature.geometry.coordinates[0]);
  const bbox = turf.bbox(localFeature);
  const bboxArea = Math.max(1e-6, (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]));
  const clipRatio = clamp(localArea / bboxArea, 0, 1);
  const confidence = clamp(1 - (1 - clipRatio) * 0.35 - Math.abs(farmlandMask - cropMask) * 0.15 + rng() * 0.05, 0, 1);
  const rotation = Math.round((rng() * 15 - 7.5) * 100) / 100;
  const jitter = Math.round((0.02 + rng() * 0.16) * 1000) / 1000;
  const shapeType = mode === 'voronoi'
    ? 'voronoi'
    : clipRatio >= 0.9 && Math.max(cell.x1 - cell.x0, cell.y1 - cell.y0) / Math.max(1e-6, Math.min(cell.x1 - cell.x0, cell.y1 - cell.y0)) <= 1.35
      ? 'rectangular'
      : 'irregular-rect';

  const geoGeometry = transformLocalGeometryToGeo(localFeature.geometry);
  const geoFeature = turf.feature(geoGeometry);
  const areaHa = Math.round((turf.area(geoFeature) / 10000) * 100) / 100;
  const parcelId = `KOS-${district.abbr}-${String(index).padStart(6, '0')}`;
  const status = harvestHealth >= 75 ? 'Healthy' : harvestHealth >= 50 ? 'Watch' : 'Critical Alert';

  return {
    parcelFeature: {
      type: 'Feature',
      properties: {
        id: parcelId,
        parcelIndex: index,
        district: district.name,
        centroid: [round(geoCentroid[0]), round(geoCentroid[1])],
        areaHa,
        shapeType,
        landUse,
        cropType,
        isFarmland: Boolean(isFarmland),
        farmScore,
        harvestHealth,
        soilQuality,
        waterAccess,
        slopeRisk,
        confidence: round(confidence),
        maskValues: {
          farmland: round(farmlandMask),
          density: round(densityMask),
          health: round(healthMask),
          cropType: round(cropMask)
        },
        noise: {
          seed,
          jitter,
          rotation
        },
        labels: ['synthetic', 'demo', isFarmland ? 'farmland' : 'non-farmland']
      },
      geometry: geoGeometry
    },
    pointFeature: {
      type: 'Feature',
      properties: {
        id: parcelId,
        parcelId,
        district: district.name,
        status,
        isFarmland: Boolean(isFarmland),
        farmScore
      },
      geometry: {
        type: 'Point',
        coordinates: [round(geoCentroid[0]), round(geoCentroid[1])]
      }
    }
  };
}

function createBorderFeature(borderGeometry) {
  return turf.feature(borderGeometry);
}

function buildCells(borderFeature, masks, args, rng) {
  if (args.mode === 'voronoi') {
    return buildVoronoiCells(args.targetParcels, rng).map((cell) => ({
      ...cell,
      localFeature: turf.polygon([cell.ring])
    }));
  }

  return buildGridCells(args.targetParcels, masks, rng).map((cell) => {
    const ring = [
      [cell.x0, cell.y0],
      [cell.x1, cell.y0],
      [cell.x1, cell.y1],
      [cell.x0, cell.y1],
      [cell.x0, cell.y0]
    ];
    return {
      ...cell,
      localFeature: turf.polygon([ring])
    };
  });
}

function generateData(borderFeature, masks, args) {
  const rng = createRng(args.seed);
  const cells = buildCells(borderFeature, masks, args, rng);
  const parcelFeatures = [];
  const pointFeatures = [];

  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    const clipped = clipToBorder(cell.localFeature, borderFeature);
    if (!clipped) continue;
    const geometry = clipped.geometry;
    if (!geometry) continue;
    const selectedGeometry = geometry.type === 'Polygon'
      ? geometry
      : pickLargestPolygonCoordinates(geometry) && { type: 'Polygon', coordinates: pickLargestPolygonCoordinates(geometry) };
    if (!selectedGeometry) continue;

    const localFeature = turf.feature(selectedGeometry);
    const { parcelFeature, pointFeature } = buildFeature(i + 1, cell, localFeature, masks, args.seed, rng, args.mode);
    parcelFeatures.push(parcelFeature);
    pointFeatures.push(pointFeature);
  }

  return { parcelFeatures, pointFeatures };
}

function buildMetadata(parcelFeatures, pointFeatures, args, maskSources) {
  const districtCounts = new Map();
  const landUseCounts = new Map();
  let farmlandCount = 0;

  for (const feature of parcelFeatures) {
    const props = feature.properties;
    districtCounts.set(props.district, (districtCounts.get(props.district) || 0) + 1);
    landUseCounts.set(props.landUse, (landUseCounts.get(props.landUse) || 0) + 1);
    if (props.isFarmland) farmlandCount += 1;
  }

  const summary = {
    parcelCount: parcelFeatures.length,
    pointCount: pointFeatures.length,
    farmlandShare: Math.round((farmlandCount / Math.max(1, parcelFeatures.length)) * 1000) / 1000,
    districtCounts: Object.fromEntries([...districtCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    landUseCounts: Object.fromEntries([...landUseCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
  };

  return {
    generatedAt: utcNow(),
    seed: args.seed,
    mode: args.mode,
    targetParcels: args.targetParcels,
    borderBounds: KOSOVO_BOUNDS,
    inputs: {
      border: maskSources.border || null,
      farmlandMask: maskSources.farmlandMask || null,
      densityMask: maskSources.densityMask || null,
      healthMask: maskSources.healthMask || null,
      cropTypeMask: maskSources.cropTypeMask || null
    },
    summary
  };
}

function ensureOutDir(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
}

function writeOutputs(outDir, parcelFeatures, pointFeatures, metadata) {
  const parcelsGeoJSON = {
    type: 'FeatureCollection',
    features: parcelFeatures
  };
  const pointsGeoJSON = {
    type: 'FeatureCollection',
    features: pointFeatures
  };

  fs.writeFileSync(path.join(outDir, 'kosovo-parcels.geojson'), `${JSON.stringify(parcelsGeoJSON, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'kosovo-parcels.meta.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'kosovo-parcels-points.geojson'), `${JSON.stringify(pointsGeoJSON, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'kosovo-bounds.json'), `${JSON.stringify({ bounds: KOSOVO_BOUNDS, crs: 'EPSG:4326' }, null, 2)}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(args.outDir);
  ensureOutDir(outDir);

  const borderGeometry = loadBorderGeometry(args.border);
  const borderFeature = createBorderFeature(borderGeometry);
  const masks = {
    farmland: loadPngMask(args.farmlandMask),
    density: loadPngMask(args.densityMask),
    health: loadPngMask(args.healthMask),
    cropType: loadPngMask(args.cropTypeMask)
  };

  const { parcelFeatures, pointFeatures } = generateData(borderFeature, masks, args);
  const metadata = buildMetadata(parcelFeatures, pointFeatures, args, {
    border: args.border,
    farmlandMask: args.farmlandMask,
    densityMask: args.densityMask,
    healthMask: args.healthMask,
    cropTypeMask: args.cropTypeMask
  });

  writeOutputs(outDir, parcelFeatures, pointFeatures, metadata);
  console.log(`Generated ${parcelFeatures.length} parcels and ${pointFeatures.length} points into ${outDir}`);
  console.log(`Mode: ${args.mode} | Seed: ${args.seed}`);
}

main();
