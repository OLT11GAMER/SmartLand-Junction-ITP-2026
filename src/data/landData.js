import { detailedParcels, regionalSummaryData } from './generatedLandData.js';

export { detailedParcels, regionalSummaryData };

export const adminUser = {
  name: 'Government Admin',
  role: 'Administrator',
  municipality: 'Kosovo'
};

export const demoOwner = {
  id: 'OWN-AGIM',
  name: 'Agim Berisha'
};

export const kosovoBounds = [
  // GeoJSON order: [westLng, southLat] then [eastLng, northLat]
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

  return Array.from(buckets.values())
    .map((bucket) => ({
      ...bucket,
      health: Math.round(bucket.health / Math.max(1, bucket.parcels))
    }))
    .sort((a, b) => b.alerts - a.alerts || a.health - b.health);
}
