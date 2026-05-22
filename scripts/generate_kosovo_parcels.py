#!/usr/bin/env python3
"""
Generate synthetic cadastral and agricultural parcels for Kosovo.

The script is deterministic, accepts an optional SVG/GeoJSON border, and can
use grayscale mask images to bias parcel density, farmland likelihood, crop
type, and harvest health. If mask inputs are missing, it falls back to smooth
procedural noise so the generator still works end-to-end.

Default output:
  data/kosovo-parcels.geojson
  data/kosovo-parcels.meta.json
  data/kosovo-parcels-points.geojson
  data/kosovo-bounds.json
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image
from shapely import affinity
from shapely.geometry import MultiPolygon, Point, Polygon, box, shape
from shapely.ops import unary_union

try:
    from scipy.spatial import Voronoi
except Exception:  # pragma: no cover - optional dependency
    Voronoi = None


KOSOVO_BOUNDS = (19.85, 41.82, 21.95, 43.32)
DEFAULT_SEED = 918273

DISTRICTS = [
    {"name": "Prizren", "abbr": "PRZ", "center": (20.739, 42.214)},
    {"name": "Pristina", "abbr": "PRT", "center": (21.165, 42.662)},
    {"name": "Peja", "abbr": "PEJ", "center": (20.292, 42.660)},
    {"name": "Gjakova", "abbr": "GJK", "center": (20.430, 42.381)},
    {"name": "Ferizaj", "abbr": "FRZ", "center": (21.146, 42.370)},
    {"name": "Gjilan", "abbr": "GJN", "center": (21.466, 42.463)},
    {"name": "Mitrovica", "abbr": "MIT", "center": (20.867, 42.891)},
    {"name": "Rahovec", "abbr": "RAH", "center": (20.650, 42.371)},
    {"name": "Suhareka", "abbr": "SUH", "center": (20.825, 42.355)},
    {"name": "Podujeva", "abbr": "PDJ", "center": (21.192, 42.911)},
    {"name": "Lipjan", "abbr": "LPJ", "center": (21.138, 42.530)},
    {"name": "Malisheva", "abbr": "MLS", "center": (20.745, 42.482)},
]

CROP_TYPES = [
    "wheat",
    "corn",
    "barley",
    "potato",
    "beans",
    "vegetables",
    "orchard",
    "vineyard",
    "pasture",
]

LAND_USES = ["farmland", "pasture", "orchard", "vineyard", "fallow", "forest_edge", "mixed"]

SVG_COMMAND_RE = re.compile(r"[MmLlHhVvZz]|-?\d+(?:\.\d+)?(?:e[-+]?\d+)?", re.IGNORECASE)


@dataclass
class Cell:
    x0: float
    y0: float
    x1: float
    y1: float
    depth: int = 0
    polygon: Optional[Polygon] = None

    @property
    def width(self) -> float:
        return self.x1 - self.x0

    @property
    def height(self) -> float:
        return self.y1 - self.y0

    @property
    def area(self) -> float:
        return max(0.0, self.width * self.height)

    @property
    def center(self) -> Tuple[float, float]:
        return ((self.x0 + self.x1) / 2.0, (self.y0 + self.y1) / 2.0)


def clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def weighted_choice(options: Sequence[Tuple[str, float]], rng: random.Random) -> str:
    total = sum(weight for _, weight in options)
    if total <= 0:
        return options[0][0]
    pick = rng.random() * total
    upto = 0.0
    for item, weight in options:
        upto += weight
        if pick <= upto:
            return item
    return options[-1][0]


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate synthetic Kosovo parcel GeoJSON files.")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED, help="Deterministic seed.")
    parser.add_argument("--mode", choices=["grid", "voronoi"], default="grid", help="Parcel generation strategy.")
    parser.add_argument("--target-parcels", type=int, default=720, help="Approximate parcel count.")
    parser.add_argument("--border", type=Path, default=None, help="Optional border SVG or GeoJSON file.")
    parser.add_argument("--farmland-mask", type=Path, default=None, help="Optional grayscale farmland mask.")
    parser.add_argument("--density-mask", type=Path, default=None, help="Optional grayscale density mask.")
    parser.add_argument("--health-mask", type=Path, default=None, help="Optional grayscale health mask.")
    parser.add_argument("--crop-type-mask", type=Path, default=None, help="Optional grayscale crop mask.")
    parser.add_argument("--out-dir", type=Path, default=Path("data"), help="Output directory.")
    return parser.parse_args()


def load_image_mask(path: Optional[Path]) -> Optional[np.ndarray]:
    if not path:
        return None
    if not path.exists():
        print(f"[warn] Mask not found: {path}", file=sys.stderr)
        return None
    image = Image.open(path).convert("L")
    return np.asarray(image, dtype=np.uint8)


def sample_array_bilinear(arr: np.ndarray, x: float, y: float) -> float:
    height, width = arr.shape[:2]
    px = clamp(x, 0.0, 1.0) * (width - 1)
    py = clamp(y, 0.0, 1.0) * (height - 1)
    x0 = int(math.floor(px))
    y0 = int(math.floor(py))
    x1 = min(x0 + 1, width - 1)
    y1 = min(y0 + 1, height - 1)
    tx = px - x0
    ty = py - y0
    top = arr[y0, x0] * (1 - tx) + arr[y0, x1] * tx
    bottom = arr[y1, x0] * (1 - tx) + arr[y1, x1] * tx
    return float((top * (1 - ty) + bottom * ty) / 255.0)


def procedural_mask(name: str, x: float, y: float, seed: int) -> float:
    base = (sum(ord(c) for c in name) * 0.0017) + seed * 0.00013
    value = 0.5
    value += 0.24 * math.sin((x + base) * 12.6) * math.cos((y - base) * 9.8)
    value += 0.14 * math.sin((x * 3.3 + y * 2.1 + base) * 7.4)
    value += 0.08 * math.cos((x - y + base) * 14.0)
    return clamp(value, 0.0, 1.0)


def sample_mask(arr: Optional[np.ndarray], name: str, x: float, y: float, seed: int) -> float:
    if arr is None:
        return procedural_mask(name, x, y, seed)
    return sample_array_bilinear(arr, x, y)


def normalize_to_unit(geom: Polygon) -> Polygon:
    minx, miny, maxx, maxy = geom.bounds
    width = maxx - minx
    height = maxy - miny
    if width <= 0 or height <= 0:
        raise ValueError("Border geometry has invalid bounds.")
    scaled = affinity.scale(geom, xfact=1.0 / width, yfact=1.0 / height, origin=(minx, miny))
    translated = affinity.translate(scaled, xoff=-minx / width, yoff=-miny / height)
    fixed = translated.buffer(0)
    if fixed.geom_type == "MultiPolygon":
        fixed = max(fixed.geoms, key=lambda g: g.area)
    if fixed.geom_type != "Polygon":
        raise ValueError("Normalized border is not a polygon.")
    return fixed


def polygon_from_points(points: List[Tuple[float, float]]) -> Polygon:
    poly = Polygon(points)
    if not poly.is_valid:
        poly = poly.buffer(0)
    if poly.geom_type == "MultiPolygon":
        poly = max(poly.geoms, key=lambda g: g.area)
    if poly.geom_type != "Polygon":
        raise ValueError("Unable to parse polygon geometry.")
    return poly


def parse_svg_points(value: str) -> List[Tuple[float, float]]:
    parts = re.split(r"\s+", value.strip())
    points: List[Tuple[float, float]] = []
    for part in parts:
        if not part:
            continue
        if "," in part:
            x_str, y_str = part.split(",", 1)
        else:
            coords = part.split()
            if len(coords) != 2:
                continue
            x_str, y_str = coords
        points.append((float(x_str), float(y_str)))
    return points


def parse_simple_svg_path(d: str) -> List[Tuple[float, float]]:
    tokens = SVG_COMMAND_RE.findall(d)
    points: List[Tuple[float, float]] = []
    idx = 0
    command = None
    current = (0.0, 0.0)
    start = None

    def read_number() -> float:
        nonlocal idx
        if idx >= len(tokens):
            raise ValueError("Unexpected end of SVG path.")
        token = tokens[idx]
        idx += 1
        return float(token)

    while idx < len(tokens):
        token = tokens[idx]
        if token.isalpha():
            command = token
            idx += 1
            if command in "Zz":
                if start is not None:
                    points.append(start)
                continue
        if command in ("M", "m"):
            x = read_number()
            y = read_number()
            if command == "m":
                x += current[0]
                y += current[1]
            current = (x, y)
            start = current
            points.append(current)
            command = "L" if command == "M" else "l"
        elif command in ("L", "l"):
            x = read_number()
            y = read_number()
            if command == "l":
                x += current[0]
                y += current[1]
            current = (x, y)
            points.append(current)
        elif command in ("H", "h"):
            x = read_number()
            if command == "h":
                x += current[0]
            current = (x, current[1])
            points.append(current)
        elif command in ("V", "v"):
            y = read_number()
            if command == "v":
                y += current[1]
            current = (current[0], y)
            points.append(current)
        else:
            raise ValueError("SVG path contains unsupported commands. Convert it to a polygon or GeoJSON first.")
    return points


def load_border_geometry(path: Optional[Path]) -> Polygon:
    if path is None or not path.exists():
        return default_border_outline()

    suffix = path.suffix.lower()
    if suffix in {".json", ".geojson"}:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("type") == "FeatureCollection":
            geoms = [shape(feature["geometry"]) for feature in data["features"] if feature.get("geometry")]
            geom = unary_union(geoms)
        elif data.get("type") == "Feature":
            geom = shape(data["geometry"])
        else:
            geom = shape(data)
        if geom.geom_type == "MultiPolygon":
            geom = max(geom.geoms, key=lambda g: g.area)
        return normalize_to_unit(geom)

    if suffix == ".svg":
        root = ET.parse(path).getroot()
        namespace = "{http://www.w3.org/2000/svg}"

        polygon_node = root.find(f".//{namespace}polygon")
        polyline_node = root.find(f".//{namespace}polyline")
        path_node = root.find(f".//{namespace}path")

        if polygon_node is not None and polygon_node.get("points"):
            geom = polygon_from_points(parse_svg_points(polygon_node.get("points")))
            return normalize_to_unit(geom)

        if polyline_node is not None and polyline_node.get("points"):
            points = parse_svg_points(polyline_node.get("points"))
            geom = polygon_from_points(points)
            return normalize_to_unit(geom)

        if path_node is not None and path_node.get("d"):
            points = parse_simple_svg_path(path_node.get("d"))
            geom = polygon_from_points(points)
            return normalize_to_unit(geom)

        raise ValueError(
            "SVG border did not contain a polygon, polyline, or simple path. "
            "Export the Kosovo border as SVG polygon points or use GeoJSON."
        )

    raise ValueError(f"Unsupported border format: {path}")


def default_border_outline() -> Polygon:
    # A rough normalized Kosovo silhouette for out-of-the-box demo generation.
    points = [
        (0.12, 0.16),
        (0.19, 0.08),
        (0.31, 0.06),
        (0.40, 0.10),
        (0.53, 0.05),
        (0.66, 0.11),
        (0.80, 0.18),
        (0.87, 0.31),
        (0.83, 0.47),
        (0.88, 0.63),
        (0.82, 0.78),
        (0.70, 0.88),
        (0.57, 0.92),
        (0.43, 0.87),
        (0.31, 0.91),
        (0.20, 0.84),
        (0.12, 0.70),
        (0.08, 0.53),
        (0.10, 0.34),
    ]
    return polygon_from_points(points)


def make_units(target_parcels: int, rng: random.Random) -> Tuple[int, int]:
    # A near-square base grid with a slight rectangle bias for farmland-like plots.
    cols = max(14, int(round(math.sqrt(target_parcels * 1.25))))
    rows = max(10, int(round(target_parcels / cols)))
    return rows, cols


def subdivide_cell(cell: Cell, density: float, farmland: float, rng: random.Random) -> List[Cell]:
    if cell.width < 0.03 or cell.height < 0.03:
        return [cell]

    split_score = 0.18 + density * 0.45 + farmland * 0.22 + rng.random() * 0.12
    if split_score < 0.58:
        return [cell]

    ratio = 0.40 + rng.random() * 0.20
    if split_score > 0.79:
        split_x = cell.x0 + cell.width * ratio
        split_y = cell.y0 + cell.height * (0.40 + rng.random() * 0.20)
        return [
            Cell(cell.x0, cell.y0, split_x, split_y, cell.depth + 1),
            Cell(split_x, cell.y0, cell.x1, split_y, cell.depth + 1),
            Cell(cell.x0, split_y, split_x, cell.y1, cell.depth + 1),
            Cell(split_x, split_y, cell.x1, cell.y1, cell.depth + 1),
        ]

    if cell.width >= cell.height:
        split_x = cell.x0 + cell.width * ratio
        return [
            Cell(cell.x0, cell.y0, split_x, cell.y1, cell.depth + 1),
            Cell(split_x, cell.y0, cell.x1, cell.y1, cell.depth + 1),
        ]

    split_y = cell.y0 + cell.height * ratio
    return [
        Cell(cell.x0, cell.y0, cell.x1, split_y, cell.depth + 1),
        Cell(cell.x0, split_y, cell.x1, cell.y1, cell.depth + 1),
    ]


def voronoi_finite_polygons_2d(vor: "Voronoi", radius: Optional[float] = None):
    if Voronoi is None:
        raise RuntimeError("scipy is required for Voronoi mode.")

    if vor.points.shape[1] != 2:
        raise ValueError("Requires 2D input.")

    new_regions: List[List[int]] = []
    new_vertices = vor.vertices.tolist()

    center = vor.points.mean(axis=0)
    if radius is None:
        radius = vor.points.ptp().max() * 2

    all_ridges: Dict[int, List[Tuple[int, int]]] = {}
    for (p1, p2), (v1, v2) in zip(vor.ridge_points, vor.ridge_vertices):
        all_ridges.setdefault(p1, []).append((p2, v1, v2))
        all_ridges.setdefault(p2, []).append((p1, v1, v2))

    for p1, region_index in enumerate(vor.point_region):
        vertices = vor.regions[region_index]
        if all(v >= 0 for v in vertices):
            new_regions.append(vertices)
            continue

        ridges = all_ridges[p1]
        new_region = [v for v in vertices if v >= 0]

        for p2, v1, v2 in ridges:
            if v2 < 0:
                v1, v2 = v2, v1
            if v1 >= 0 and v2 >= 0:
                continue

            tangent = vor.points[p2] - vor.points[p1]
            tangent /= np.linalg.norm(tangent)
            normal = np.array([-tangent[1], tangent[0]])
            midpoint = vor.points[[p1, p2]].mean(axis=0)
            direction = np.sign(np.dot(midpoint - center, normal)) * normal
            far_point = vor.vertices[v2] + direction * radius
            new_vertices.append(far_point.tolist())
            new_region.append(len(new_vertices) - 1)

        vs = np.asarray([new_vertices[v] for v in new_region])
        c = vs.mean(axis=0)
        angles = np.arctan2(vs[:, 1] - c[1], vs[:, 0] - c[0])
        new_region = [v for _, v in sorted(zip(angles, new_region))]
        new_regions.append(new_region)

    return new_regions, np.asarray(new_vertices)


def build_voronoi_cells(border: Polygon, rows: int, cols: int, rng: random.Random) -> List[Cell]:
    if Voronoi is None:
        raise RuntimeError("Voronoi mode requested, but scipy is not installed.")

    points = []
    for row in range(rows):
        for col in range(cols):
            x = (col + 0.5) / cols
            y = (row + 0.5) / rows
            jitter_x = (rng.random() - 0.5) * (1.0 / cols) * 0.32
            jitter_y = (rng.random() - 0.5) * (1.0 / rows) * 0.32
            points.append([clamp(x + jitter_x, 0.01, 0.99), clamp(y + jitter_y, 0.01, 0.99)])

    vor = Voronoi(np.asarray(points))
    regions, vertices = voronoi_finite_polygons_2d(vor)

    cells: List[Cell] = []
    for point, region in zip(points, regions):
        polygon = Polygon(vertices[region]).buffer(0)
        if polygon.is_empty:
            continue
        clipped = polygon.intersection(border)
        if clipped.is_empty:
            continue
        if clipped.geom_type == "MultiPolygon":
            clipped = max(clipped.geoms, key=lambda g: g.area)
        if clipped.area < 1e-5:
            continue
        minx, miny, maxx, maxy = clipped.bounds
        cells.append(Cell(minx, miny, maxx, maxy, 0, clipped))
    return cells


def build_cells(
    border: Polygon,
    target_parcels: int,
    mode: str,
    rng: random.Random,
    masks: Dict[str, Optional[np.ndarray]],
) -> List[Cell]:
    rows, cols = make_units(target_parcels, rng)

    if mode == "voronoi":
        return build_voronoi_cells(border, rows, cols, rng)

    x_edges = np.linspace(0.0, 1.0, cols + 1)
    y_edges = np.linspace(0.0, 1.0, rows + 1)
    leaf_cells: List[Cell] = []

    for row in range(rows):
        for col in range(cols):
            cell = Cell(float(x_edges[col]), float(y_edges[row]), float(x_edges[col + 1]), float(y_edges[row + 1]), 0)
            cx, cy = cell.center
            farmland = sample_mask(masks["farmland"], "farmland", cx, cy, 0)
            density = sample_mask(masks["density"], "density", cx, cy, 0)
            leaf_cells.extend(subdivide_cell(cell, density, farmland, rng))

    return leaf_cells


def local_to_geo(x: float, y: float) -> Tuple[float, float]:
    min_lon, min_lat, max_lon, max_lat = KOSOVO_BOUNDS
    lon = min_lon + x * (max_lon - min_lon)
    lat = max_lat - y * (max_lat - min_lat)
    return lon, lat


def geo_polygon_area_ha(coords: List[Tuple[float, float]]) -> float:
    if len(coords) < 3:
        return 0.0
    polygon = Polygon(coords)
    if polygon.is_empty:
        return 0.0
    lon0, lat0 = polygon.centroid.x, polygon.centroid.y
    meters_per_deg_lon = 111320.0 * math.cos(math.radians(lat0))
    meters_per_deg_lat = 110540.0
    projected = [
        ((lon - lon0) * meters_per_deg_lon, (lat - lat0) * meters_per_deg_lat)
        for lon, lat in coords
    ]
    area_m2 = abs(Polygon(projected).area)
    return round(area_m2 / 10000.0, 2)


def pick_district(lon: float, lat: float) -> Dict[str, object]:
    best = None
    best_distance = float("inf")
    for district in DISTRICTS:
        dx = lon - district["center"][0]
        dy = lat - district["center"][1]
        distance = dx * dx + dy * dy
        if distance < best_distance:
            best = district
            best_distance = distance
    assert best is not None
    return best


def crop_bias_for_district(district_name: str) -> Dict[str, float]:
    return {
        "Prizren": {"vineyard": 1.45, "orchard": 1.15, "vegetables": 1.10, "wheat": 1.05},
        "Rahovec": {"vineyard": 1.75, "orchard": 1.25, "wheat": 0.95},
        "Suhareka": {"wheat": 1.20, "corn": 1.10, "orchard": 1.05},
        "Pristina": {"wheat": 1.25, "corn": 1.20, "vegetables": 1.15},
        "Peja": {"pasture": 1.20, "orchard": 1.12, "beans": 1.05},
        "Gjakova": {"wheat": 1.20, "corn": 1.15, "vegetables": 1.05},
        "Ferizaj": {"corn": 1.20, "wheat": 1.15, "beans": 1.05},
        "Gjilan": {"corn": 1.10, "wheat": 1.10, "orchard": 1.05},
        "Mitrovica": {"pasture": 1.25, "wheat": 1.05, "barley": 1.05},
        "Podujeva": {"wheat": 1.20, "barley": 1.15, "pasture": 1.05},
        "Lipjan": {"vegetables": 1.18, "wheat": 1.12, "corn": 1.08},
        "Malisheva": {"wheat": 1.10, "vineyard": 1.05, "pasture": 1.05},
    }.get(district_name, {})


def choose_crop_type(is_farmland: bool, district: str, crop_mask: float, rng: random.Random) -> str:
    if not is_farmland:
        return weighted_choice([("pasture", 0.6), ("fallow", 0.25), ("mixed", 0.15)], rng)

    bias = crop_bias_for_district(district)
    weights = []
    for crop in CROP_TYPES:
        weight = 1.0
        weight *= bias.get(crop, 1.0)
        if crop == "vineyard":
            weight *= 0.7 + crop_mask * 1.4
        elif crop == "orchard":
            weight *= 0.8 + crop_mask * 1.1
        elif crop == "vegetables":
            weight *= 0.75 + crop_mask * 1.0
        elif crop in {"wheat", "barley", "corn"}:
            weight *= 0.9 + (1.0 - abs(crop_mask - 0.55)) * 0.8
        elif crop == "pasture":
            weight *= 0.65 + (1.0 - crop_mask) * 0.8
        weights.append((crop, weight))
    return weighted_choice(weights, rng)


def choose_land_use(is_farmland: bool, farmland_mask: float, density_mask: float, slope_risk: int, rng: random.Random) -> str:
    if is_farmland:
        return weighted_choice([
            ("farmland", 0.55 + farmland_mask * 0.6),
            ("orchard", 0.12 + farmland_mask * 0.2),
            ("vineyard", 0.12 + farmland_mask * 0.18),
            ("mixed", 0.10 + density_mask * 0.08),
            ("fallow", 0.06 + (1.0 - farmland_mask) * 0.08),
        ], rng)

    return weighted_choice([
        ("pasture", 0.35 + density_mask * 0.12),
        ("fallow", 0.24 + (slope_risk / 100.0) * 0.18),
        ("forest_edge", 0.24 + (1.0 - farmland_mask) * 0.15),
        ("mixed", 0.17 + density_mask * 0.10),
    ], rng)


def sample_mask_bundle(
    masks: Dict[str, Optional[np.ndarray]],
    x: float,
    y: float,
    seed: int,
) -> Dict[str, float]:
    return {
        "farmland": round(sample_mask(masks["farmland"], "farmland", x, y, seed), 3),
        "density": round(sample_mask(masks["density"], "density", x, y, seed), 3),
        "health": round(sample_mask(masks["health"], "health", x, y, seed), 3),
        "cropType": round(sample_mask(masks["cropType"], "cropType", x, y, seed), 3),
    }


def shape_type_for(clip_ratio: float, width: float, height: float, mode: str) -> str:
    if mode == "voronoi":
        return "voronoi"
    aspect = max(width, height) / max(1e-6, min(width, height))
    if clip_ratio >= 0.90 and aspect <= 1.35:
        return "rectangular"
    return "irregular-rect"


def geometry_to_geojson(poly: Polygon) -> Dict[str, object]:
    return json.loads(json.dumps(poly.__geo_interface__))


def make_feature(
    index: int,
    cell: Cell,
    geom_local: Polygon,
    masks: Dict[str, Optional[np.ndarray]],
    seed: int,
    rng: random.Random,
    mode: str,
) -> Tuple[Dict[str, object], Dict[str, object]]:
    centroid = geom_local.centroid
    cx, cy = centroid.x, centroid.y

    center_masks = sample_mask_bundle(masks, cx, cy, seed + index)
    ring_samples = [
        sample_mask_bundle(masks, clamp(cx + dx, 0.0, 1.0), clamp(cy + dy, 0.0, 1.0), seed + index + i + 1)
        for i, (dx, dy) in enumerate(
            [(-0.08, 0.0), (0.08, 0.0), (0.0, -0.08), (0.0, 0.08), (-0.05, -0.05), (0.05, 0.05)]
        )
    ]

    farmland_mask = float(np.mean([sample["farmland"] for sample in [center_masks] + ring_samples]))
    density_mask = float(np.mean([sample["density"] for sample in [center_masks] + ring_samples]))
    health_mask = float(np.mean([sample["health"] for sample in [center_masks] + ring_samples]))
    crop_mask = float(np.mean([sample["cropType"] for sample in [center_masks] + ring_samples]))

    lon, lat = local_to_geo(cx, cy)
    district = pick_district(lon, lat)

    farmland_prob = clamp(0.15 + farmland_mask * 0.70 + density_mask * 0.15, 0.03, 0.97)
    is_farmland = rng.random() < farmland_prob

    slope_noise = procedural_mask("slope", cx, cy, seed + 17)
    water_noise = procedural_mask("water", cx, cy, seed + 31)
    soil_noise = procedural_mask("soil", cx, cy, seed + 47)

    slope_risk = int(clamp(round((1.0 - farmland_mask * 0.55 - density_mask * 0.15 + slope_noise * 0.6) * 100), 0, 100))
    water_access = int(clamp(round((density_mask * 0.55 + health_mask * 0.25 + water_noise * 0.20) * 100), 0, 100))
    soil_quality = int(clamp(round((farmland_mask * 0.45 + health_mask * 0.25 + soil_noise * 0.30) * 100), 0, 100))

    crop_type = choose_crop_type(is_farmland, str(district["name"]), crop_mask, rng)
    land_use = choose_land_use(is_farmland, farmland_mask, density_mask, slope_risk, rng)

    crop_suitability = clamp((crop_mask * 0.6 + farmland_mask * 0.4) * 100.0, 0.0, 100.0)
    farm_score = int(clamp(round(farmland_mask * 55 + crop_suitability * 0.25 + water_access * 0.10 + rng.random() * 10), 0, 100))
    harvest_health = int(clamp(round(20 + health_mask * 60 + water_access * 0.15 - slope_risk * 0.25 + rng.random() * 10), 0, 100))

    bbox_area = max(1e-6, cell.width * cell.height)
    clip_ratio = clamp(geom_local.area / bbox_area, 0.0, 1.0)
    confidence = clamp(1.0 - (1.0 - clip_ratio) * 0.35 - abs(farmland_mask - crop_mask) * 0.15 + rng.random() * 0.05, 0.0, 1.0)

    rotation = round(rng.uniform(-7.5, 7.5), 2)
    jitter = round(rng.uniform(0.02, 0.18), 3)
    area_ha = geo_polygon_area_ha([local_to_geo(x, y) for x, y in geom_local.exterior.coords])

    parcel_id = f"KOS-{district['abbr']}-{index:06d}"
    geometry = Polygon([local_to_geo(x, y) for x, y in geom_local.exterior.coords])
    feature = {
        "type": "Feature",
        "properties": {
            "id": parcel_id,
            "parcelIndex": index,
            "district": district["name"],
            "centroid": [round(lon, 6), round(lat, 6)],
            "areaHa": area_ha,
            "shapeType": shape_type_for(clip_ratio, cell.width, cell.height, mode),
            "landUse": land_use,
            "cropType": crop_type,
            "isFarmland": bool(is_farmland),
            "farmScore": farm_score,
            "harvestHealth": harvest_health,
            "soilQuality": soil_quality,
            "waterAccess": water_access,
            "slopeRisk": slope_risk,
            "confidence": round(confidence, 3),
            "maskValues": center_masks,
            "noise": {
                "seed": seed,
                "jitter": jitter,
                "rotation": rotation,
            },
            "labels": ["synthetic", "demo", "farmland" if is_farmland else "non-farmland"],
        },
        "geometry": geometry_to_geojson(geometry),
    }

    point_feature = {
        "type": "Feature",
        "properties": {
            "id": parcel_id,
            "parcelId": parcel_id,
            "district": district["name"],
            "status": "Healthy" if harvest_health >= 75 else "Watch" if harvest_health >= 50 else "Critical Alert",
            "isFarmland": bool(is_farmland),
            "farmScore": farm_score,
        },
        "geometry": {
            "type": "Point",
            "coordinates": [round(lon, 6), round(lat, 6)],
        },
    }

    return feature, point_feature


def generate_parcels(border: Polygon, masks: Dict[str, Optional[np.ndarray]], args: argparse.Namespace) -> Tuple[List[Dict[str, object]], List[Dict[str, object]]]:
    rng = random.Random(args.seed)
    cells = build_cells(border, args.target_parcels, args.mode, rng, masks)
    features: List[Dict[str, object]] = []
    points: List[Dict[str, object]] = []

    for index, cell in enumerate(cells, start=1):
        rect = box(cell.x0, cell.y0, cell.x1, cell.y1)
        clipped = cell.polygon if cell.polygon is not None else rect.intersection(border)
        if clipped.is_empty:
            continue
        if clipped.geom_type == "MultiPolygon":
            clipped = max(clipped.geoms, key=lambda g: g.area)
        if clipped.area < 1e-6:
            continue
        feature, point_feature = make_feature(index, cell, clipped, masks, args.seed, rng, args.mode)
        features.append(feature)
        points.append(point_feature)

    return features, points


def build_metadata(
    features: List[Dict[str, object]],
    points: List[Dict[str, object]],
    border: Polygon,
    args: argparse.Namespace,
    mask_sources: Dict[str, Optional[Path]],
) -> Dict[str, object]:
    district_counts: Dict[str, int] = {}
    land_use_counts: Dict[str, int] = {}
    farmland_count = 0
    for feature in features:
        props = feature["properties"]
        district_counts[props["district"]] = district_counts.get(props["district"], 0) + 1
        land_use_counts[props["landUse"]] = land_use_counts.get(props["landUse"], 0) + 1
        if props["isFarmland"]:
            farmland_count += 1

    summary = {
        "parcelCount": len(features),
        "pointCount": len(points),
        "farmlandShare": round(farmland_count / max(1, len(features)), 3),
        "districtCounts": dict(sorted(district_counts.items(), key=lambda item: (-item[1], item[0]))),
        "landUseCounts": dict(sorted(land_use_counts.items(), key=lambda item: (-item[1], item[0]))),
    }

    return {
        "generatedAt": utc_now(),
        "seed": args.seed,
        "mode": args.mode,
        "targetParcels": args.target_parcels,
        "borderBounds": list(KOSOVO_BOUNDS),
        "borderAreaUnit": round(border.area, 4),
        "inputs": {
            "border": str(mask_sources["border"]) if mask_sources["border"] else None,
            "farmlandMask": str(mask_sources["farmland"]) if mask_sources["farmland"] else None,
            "densityMask": str(mask_sources["density"]) if mask_sources["density"] else None,
            "healthMask": str(mask_sources["health"]) if mask_sources["health"] else None,
            "cropTypeMask": str(mask_sources["cropType"]) if mask_sources["cropType"] else None,
        },
        "summary": summary,
    }


def ensure_out_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def write_outputs(out_dir: Path, features: List[Dict[str, object]], points: List[Dict[str, object]], metadata: Dict[str, object]) -> None:
    parcels_geojson = {
        "type": "FeatureCollection",
        "features": features,
    }
    points_geojson = {
        "type": "FeatureCollection",
        "features": points,
    }

    (out_dir / "kosovo-parcels.geojson").write_text(json.dumps(parcels_geojson, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "kosovo-parcels.meta.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "kosovo-parcels-points.geojson").write_text(json.dumps(points_geojson, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "kosovo-bounds.json").write_text(
        json.dumps({"bounds": list(KOSOVO_BOUNDS), "crs": "EPSG:4326"}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def main() -> int:
    args = parse_args()
    ensure_out_dir(args.out_dir)

    border = load_border_geometry(args.border)
    masks = {
        "farmland": load_image_mask(args.farmland_mask),
        "density": load_image_mask(args.density_mask),
        "health": load_image_mask(args.health_mask),
        "cropType": load_image_mask(args.crop_type_mask),
    }

    features, points = generate_parcels(border, masks, args)
    metadata = build_metadata(
        features,
        points,
        border,
        args,
        {
            "border": args.border,
            "farmland": args.farmland_mask,
            "density": args.density_mask,
            "health": args.health_mask,
            "cropType": args.crop_type_mask,
        },
    )
    write_outputs(args.out_dir, features, points, metadata)

    print(f"Generated {len(features)} parcels and {len(points)} points into {args.out_dir}.")
    print(f"Mode: {args.mode} | Seed: {args.seed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
