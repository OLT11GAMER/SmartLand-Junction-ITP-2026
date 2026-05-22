const municipalities = [
  { name: 'Prizren', center: [20.739, 42.214], spread: [0.13, 0.08], yieldBase: 1540 },
  { name: 'Pristina', center: [21.165, 42.662], spread: [0.11, 0.08], yieldBase: 1380 },
  { name: 'Peja', center: [20.292, 42.660], spread: [0.10, 0.08], yieldBase: 1460 },
  { name: 'Gjakova', center: [20.430, 42.381], spread: [0.12, 0.08], yieldBase: 1600 },
  { name: 'Ferizaj', center: [21.146, 42.370], spread: [0.10, 0.07], yieldBase: 1320 },
  { name: 'Gjilan', center: [21.466, 42.463], spread: [0.10, 0.07], yieldBase: 1260 },
  { name: 'Mitrovica', center: [20.867, 42.891], spread: [0.10, 0.07], yieldBase: 1210 },
  { name: 'Rahovec', center: [20.650, 42.371], spread: [0.08, 0.06], yieldBase: 1710 },
  { name: 'Suhareka', center: [20.825, 42.355], spread: [0.08, 0.06], yieldBase: 1510 }
];

const crops = [
  { name: 'Wheat', rotation: ['Legumes', 'Corn', 'Fallow cover'], monoRisk: 0.42 },
  { name: 'Corn', rotation: ['Wheat', 'Beans', 'Vegetables'], monoRisk: 0.55 },
  { name: 'Vineyard', rotation: ['Cover crop', 'Soil restoration'], monoRisk: 0.28 },
  { name: 'Orchard', rotation: ['Cover crop', 'Pasture strip'], monoRisk: 0.31 },
  { name: 'Pasture', rotation: ['Hay', 'Legumes'], monoRisk: 0.24 },
  { name: 'Vegetables', rotation: ['Wheat', 'Beans', 'Cover crop'], monoRisk: 0.37 }
];

const owners = [
  { id: 'OWN-AGIM', name: 'Agim Berisha', municipality: 'Prizren', phone: '+383 44 200 181', role: 'Land Owner' },
  { id: 'OWN-217', name: 'Arta Krasniqi', municipality: 'Pristina', phone: '+383 44 355 240', role: 'Land Owner' },
  { id: 'OWN-311', name: 'Valon Hyseni', municipality: 'Peja', phone: '+383 44 411 903', role: 'Land Owner' },
  { id: 'OWN-404', name: 'Blerina Gashi', municipality: 'Gjakova', phone: '+383 44 392 108', role: 'Land Owner' },
  { id: 'OWN-532', name: 'Naim Gashi', municipality: 'Ferizaj', phone: '+383 44 322 771', role: 'Land Owner' },
  { id: 'OWN-610', name: 'Driton Morina', municipality: 'Gjilan', phone: '+383 44 500 022', role: 'Land Owner' }
];

function random(seed) {
  let t = seed + 0x6d2b79f5;
  return function next() {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function statusFor(score) {
  if (score >= 74) return 'Healthy';
  if (score >= 50) return 'Watch';
  return 'Critical Alert';
}

function colorFor(status) {
  if (status === 'Healthy') return '#3c7b45';
  if (status === 'Watch') return '#d4a84f';
  return '#c6473c';
}

function hashBlock(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `0x${(h >>> 0).toString(16).padStart(8, '0')}`;
}

function parcelPolygon(center, seed, size = 0.009) {
  const rng = random(seed);
  const [lng, lat] = center;
  const w = size * (0.7 + rng() * 0.8);
  const h = size * (0.65 + rng() * 0.9);
  const skew = (rng() - 0.5) * size * 0.3;
  return [[
    [lng - w, lat - h],
    [lng + w + skew, lat - h * 0.82],
    [lng + w, lat + h],
    [lng - w - skew, lat + h * 0.78],
    [lng - w, lat - h]
  ]];
}

function makeTimeline(seed, score) {
  const rng = random(seed);
  return Array.from({ length: 8 }, (_, index) => {
    const month = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'][index];
    const seasonal = Math.sin(index / 7 * Math.PI) * 18;
    const value = Math.round(clamp(score - 12 + seasonal + (rng() - 0.5) * 18, 8, 99));
    return { month, ndvi: value, activity: Math.round(clamp(value + (rng() - 0.5) * 14, 5, 100)) };
  });
}

function makeLedger(id, owner, status, seed) {
  const actions = [
    'Farmer crop declaration',
    'Sentinel seasonal check',
    'Municipality risk review',
    'Compliance advisory generated'
  ];
  let previousHash = 'genesis';
  return actions.map((action, index) => {
    const date = new Date(2026, 1 + index, 4 + (seed % 18), 9 + index, 14);
    const hash = hashBlock(`${id}|${owner}|${action}|${previousHash}|${date.toISOString()}`);
    const record = {
      id: `${id}-BLK-${index + 1}`,
      timestamp: date.toISOString(),
      action,
      status,
      previousHash,
      hash
    };
    previousHash = hash;
    return record;
  });
}

function buildDetailedParcels() {
  const parcels = [];
  let id = 1;
  municipalities.forEach((municipality, muniIndex) => {
    for (let local = 0; local < 16; local += 1) {
      const rng = random(5000 + id * 31);
      const owner = municipality.name === 'Prizren' && local < 5
        ? owners[0]
        : owners[(local + muniIndex) % (owners.length - 1) + 1];
      const crop = crops[(local + muniIndex + id) % crops.length];
      const point = [
        municipality.center[0] + (rng() - 0.5) * municipality.spread[0],
        municipality.center[1] + (rng() - 0.5) * municipality.spread[1]
      ];
      const inactivity = Math.round(rng() * 100);
      const seasonalDeviation = Math.round(rng() * 100);
      const engagementGap = Math.round(rng() * 100);
      const historyRisk = Math.round((rng() * 70) + crop.monoRisk * 30);
      const weightedRisk = inactivity * 0.4 + seasonalDeviation * 0.3 + engagementGap * 0.2 + historyRisk * 0.1;
      let landHealthScore = Math.round(clamp(100 - weightedRisk, 2, 98));

      if (owner.id === 'OWN-AGIM') {
        landHealthScore = [88, 64, 39, 76, 52][local];
      }

      const status = statusFor(landHealthScore);
      const abandonmentProbability = clamp((100 - landHealthScore) / 100 * 0.82 + crop.monoRisk * 0.12, 0.04, 0.94);
      const hectares = Number((0.8 + rng() * 6.2).toFixed(1));
      const projectedLoss = Math.round(municipality.yieldBase * hectares * abandonmentProbability);
      const monocultureYears = Math.round(1 + crop.monoRisk * 4 + rng() * 2);
      const complianceRisk = clamp(Math.round((100 - landHealthScore) * 0.58 + monocultureYears * 8), 4, 98);
      const parcelId = owner.id === 'OWN-AGIM' ? `AKK-PRZ-AG-${local + 1}` : `AKK-${municipality.name.slice(0, 3).toUpperCase()}-${String(id).padStart(5, '0')}`;
      const timeline = makeTimeline(9000 + id, landHealthScore);
      const geometry = {
        type: 'Polygon',
        coordinates: parcelPolygon(point, 8000 + id, 0.0048 + rng() * 0.004)
      };

      parcels.push({
        id: parcelId,
        ownerId: owner.id,
        owner: owner.name,
        phone: owner.phone,
        municipality: municipality.name,
        centroid: point,
        geometry,
        currentCrop: crop.name,
        suggestedRotation: crop.rotation,
        landHealthScore,
        status,
        color: colorFor(status),
        abandonmentProbability,
        hectares,
        projectedLoss,
        complianceRisk,
        monocultureYears,
        cropHistory: timeline,
        ledger: makeLedger(parcelId, owner.name, status, id),
        advisory: landHealthScore < 50
          ? 'Prioritize outreach, verify seasonal use, and recommend crop rotation before inspection.'
          : landHealthScore < 74
            ? 'Send a crop rotation suggestion and monitor the next Sentinel seasonal signal.'
            : 'Parcel is operating normally; keep routine seasonal monitoring active.'
      });
      id += 1;
    }
  });
  return parcels;
}

function buildRegionalPoints(parcels) {
  const features = [];
  let id = 1;
  municipalities.forEach((municipality, muniIndex) => {
    const target = 2048;
    for (let index = 0; index < target; index += 1) {
      const rng = random(11000 + muniIndex * 10000 + index);
      const detail = parcels[(index + muniIndex * 7) % parcels.length];
      const score = clamp(Math.round(detail.landHealthScore + (rng() - 0.5) * 28), 3, 98);
      const status = statusFor(score);
      features.push({
        type: 'Feature',
        id: id,
        geometry: {
          type: 'Point',
          coordinates: [
            municipality.center[0] + (rng() - 0.5) * municipality.spread[0] * 2.8,
            municipality.center[1] + (rng() - 0.5) * municipality.spread[1] * 2.4
          ]
        },
        properties: {
          id: `SIM-${String(id).padStart(5, '0')}`,
          detailId: detail.id,
          municipality: municipality.name,
          status,
          color: colorFor(status),
          health: score,
          currentCrop: detail.currentCrop,
          complianceRisk: detail.complianceRisk
        }
      });
      id += 1;
    }
  });
  return {
    type: 'FeatureCollection',
    features
  };
}

export const detailedParcels = buildDetailedParcels();
export const regionalPointData = buildRegionalPoints(detailedParcels);
export const adminUser = {
  name: 'Government Admin',
  role: 'Administrator',
  municipality: 'Kosovo'
};
export const demoOwner = owners[0];
export const kosovoBounds = [
  [19.85, 41.82],
  [21.95, 43.32]
];

export function parcelsForRole(role) {
  if (role === 'owner') {
    return detailedParcels.filter((parcel) => parcel.ownerId === demoOwner.id);
  }
  return detailedParcels;
}

export function municipalityStats(parcels) {
  const buckets = new Map();
  parcels.forEach((parcel) => {
    const bucket = buckets.get(parcel.municipality) || {
      municipality: parcel.municipality,
      parcels: 0,
      health: 0,
      loss: 0,
      alerts: 0
    };
    bucket.parcels += 1;
    bucket.health += parcel.landHealthScore;
    bucket.loss += parcel.projectedLoss;
    bucket.alerts += parcel.status === 'Critical Alert' ? 1 : 0;
    buckets.set(parcel.municipality, bucket);
  });
  return Array.from(buckets.values()).map((bucket) => ({
    ...bucket,
    health: Math.round(bucket.health / bucket.parcels)
  })).sort((a, b) => b.alerts - a.alerts || a.health - b.health);
}
