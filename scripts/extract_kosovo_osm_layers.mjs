#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import shapefile from 'shapefile';
import * as turf from '@turf/turf';

const DEFAULT_INPUT_ROOT = '/mnt/c/Users/OLTIMERI/Downloads/kosovo-260521-free.shp';
const DEFAULT_OUTPUT_DIR = path.resolve('public/data');

const LANDUSE_KEEP_LIMITS = {
  agriculture: 2500,
  tree_crop: 1800,
  woodland: 900,
  open: 700,
  built: 700
};

const LANDUSE_CLASS_MAP = new Map([
  ['farmland', 'agriculture'],
  ['farmyard', 'agriculture'],
  ['allotments', 'agriculture'],
  ['meadow', 'open'],
  ['grass', 'open'],
  ['park', 'open'],
  ['recreation_ground', 'open'],
  ['vineyard', 'tree_crop'],
  ['orchard', 'tree_crop'],
  ['forest', 'woodland'],
  ['scrub', 'woodland'],
  ['heath', 'woodland'],
  ['residential', 'built'],
  ['industrial', 'built'],
  ['commercial', 'built'],
  ['retail', 'built'],
  ['cemetery', 'built'],
  ['military', 'built'],
  ['quarry', 'built'],
  ['landfill', 'built']
]);

function parseArgs(argv) {
  const args = {
    inputRoot: DEFAULT_INPUT_ROOT,
    outDir: DEFAULT_OUTPUT_DIR,
    simplify: 0.00018
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => argv[++i];
    if (token === '--input-root') args.inputRoot = next();
    else if (token === '--out-dir') args.outDir = path.resolve(next());
    else if (token === '--simplify') args.simplify = Number(next());
  }

  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function simplifyFeature(feature, tolerance) {
  try {
    return turf.simplify(feature, {
      tolerance,
      highQuality: false,
      mutate: false
    });
  } catch {
    return feature;
  }
}

function featureArea(feature) {
  try {
    return turf.area(feature);
  } catch {
    return 0;
  }
}

async function readLayer(shpPath) {
  const source = await shapefile.open(shpPath);
  const features = [];
  while (true) {
    const record = await source.read();
    if (record.done) break;
    if (!record.value?.geometry) continue;
    features.push(record.value);
  }
  return features;
}

function loadLayerPath(root, fileName) {
  return path.join(root, fileName);
}

function classifyLanduse(fclass) {
  return LANDUSE_CLASS_MAP.get(fclass) || null;
}

function projectFeature(feature, category, sourceLayer, sourceClass, tolerance) {
  const simplified = simplifyFeature(feature, tolerance);
  const area = featureArea(simplified);
  return {
    type: 'Feature',
    properties: {
      osm_id: feature.properties?.osm_id ?? null,
      name: feature.properties?.name ?? null,
      fclass: sourceClass,
      category,
      sourceLayer,
      areaSqM: Math.round(area),
      areaHa: Math.round((area / 10000) * 100) / 100
    },
    geometry: simplified.geometry
  };
}

function selectLargest(features, limit) {
  return features
    .sort((a, b) => (b.properties.areaSqM || 0) - (a.properties.areaSqM || 0))
    .slice(0, limit);
}

function summaryFromCollection(collection) {
  const counts = new Map();
  for (const feature of collection.features) {
    const key = feature.properties?.category || feature.properties?.fclass || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureDir(args.outDir);

  const landusePath = loadLayerPath(args.inputRoot, 'gis_osm_landuse_a_free_1.shp');
  const adminAreasPath = loadLayerPath(args.inputRoot, 'gis_osm_adminareas_a_free_1.shp');
  const waterAreasPath = loadLayerPath(args.inputRoot, 'gis_osm_water_a_free_1.shp');

  const [landuseRaw, adminRaw, waterRaw] = await Promise.all([
    readLayer(landusePath),
    readLayer(adminAreasPath),
    readLayer(waterAreasPath)
  ]);

  const landuseBuckets = new Map([
    ['agriculture', []],
    ['tree_crop', []],
    ['woodland', []],
    ['open', []],
    ['built', []]
  ]);

  for (const feature of landuseRaw) {
    const sourceClass = feature.properties?.fclass;
    const category = classifyLanduse(sourceClass);
    if (!category) continue;
    const projected = projectFeature(feature, category, 'landuse', sourceClass, args.simplify);
    if (!projected.geometry) continue;
    landuseBuckets.get(category).push(projected);
  }

  const landuseFeatures = [...landuseBuckets.entries()].flatMap(([category, features]) => {
    const limit = LANDUSE_KEEP_LIMITS[category] || features.length;
    return selectLargest(features, limit).map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        category
      }
    }));
  });

  const adminFeatures = adminRaw
    .filter((feature) => feature.geometry && ['Polygon', 'MultiPolygon'].includes(feature.geometry.type))
    .map((feature) => projectFeature(feature, 'admin', 'adminareas', feature.properties?.fclass || 'admin', args.simplify * 1.2))
    .filter((feature) => feature.geometry)
    .sort((a, b) => (b.properties.areaSqM || 0) - (a.properties.areaSqM || 0));

  const waterFeatures = waterRaw
    .filter((feature) => feature.geometry && ['Polygon', 'MultiPolygon'].includes(feature.geometry.type))
    .map((feature) => projectFeature(feature, 'water', 'water', feature.properties?.fclass || 'water', args.simplify * 1.2))
    .filter((feature) => feature.geometry)
    .sort((a, b) => (b.properties.areaSqM || 0) - (a.properties.areaSqM || 0));

  const landuseCollection = {
    type: 'FeatureCollection',
    features: landuseFeatures
  };

  const adminCollection = {
    type: 'FeatureCollection',
    features: adminFeatures
  };

  const waterCollection = {
    type: 'FeatureCollection',
    features: waterFeatures
  };

  const metadata = {
    generatedAt: new Date().toISOString(),
    inputRoot: args.inputRoot,
    simplifyTolerance: args.simplify,
    sources: {
      landuse: path.join(args.inputRoot, 'gis_osm_landuse_a_free_1.shp'),
      adminareas: path.join(args.inputRoot, 'gis_osm_adminareas_a_free_1.shp'),
      water: path.join(args.inputRoot, 'gis_osm_water_a_free_1.shp')
    },
    summary: {
      landuse: summaryFromCollection(landuseCollection),
      adminareas: summaryFromCollection(adminCollection),
      water: summaryFromCollection(waterCollection)
    }
  };

  fs.writeFileSync(path.join(args.outDir, 'kosovo-landuse.geojson'), `${JSON.stringify(landuseCollection, null, 2)}\n`);
  fs.writeFileSync(path.join(args.outDir, 'kosovo-adminareas.geojson'), `${JSON.stringify(adminCollection, null, 2)}\n`);
  fs.writeFileSync(path.join(args.outDir, 'kosovo-water.geojson'), `${JSON.stringify(waterCollection, null, 2)}\n`);
  fs.writeFileSync(path.join(args.outDir, 'kosovo-osm-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);

  console.log(`Extracted land-use layers into ${args.outDir}`);
  console.log(`Land-use features: ${landuseCollection.features.length}`);
  console.log(`Admin features: ${adminCollection.features.length}`);
  console.log(`Water features: ${waterCollection.features.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
