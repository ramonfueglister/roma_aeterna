"""Generate geographically-accurate 2048x2048 heightmap and province map.

Produces:
  - client/public/heightmaps/mediterranean.png  (grayscale heightmap)
  - client/public/heightmaps/provinces.png       (RED channel = Province-ID 0-41)

Coordinate system:
  - Longitude: -10 to 50 (60 degrees)
  - Latitude:  25 to 55  (30 degrees)
  - 2048 x 2048 pixels

Height encoding (SPECS.md authoritative):
  - 0:       deepest ocean
  - 32:      sea level (WATER_LEVEL)
  - 33-35:   coast / beach
  - 36-45:   flatlands
  - 46-60:   hills
  - 61-90:   mountains
  - 91-110:  high mountains (Alps, Taurus)
  - 111-127: snow-covered peaks

Dependencies: numpy, Pillow (PIL). No GDAL, rasterio, or geopandas.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

WIDTH = 2048
HEIGHT = 2048

LON_MIN, LON_MAX = -10.0, 50.0
LAT_MIN, LAT_MAX = 25.0, 55.0

LON_RANGE = LON_MAX - LON_MIN  # 60
LAT_RANGE = LAT_MAX - LAT_MIN  # 30

# Sea level per SPECS.md (authoritative)
WATER_LEVEL = 32
COAST_HEIGHT = 34
LAND_BASE = 38

PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = PROJECT_ROOT / "client" / "public" / "heightmaps"


# ---------------------------------------------------------------------------
# Coordinate conversion
# ---------------------------------------------------------------------------

def lon_to_x(lon: float) -> int:
    """Convert longitude to pixel x coordinate."""
    return int(((lon - LON_MIN) / LON_RANGE) * WIDTH)


def lat_to_y(lat: float) -> int:
    """Convert latitude to pixel y coordinate (north = top = y=0)."""
    return int(((LAT_MAX - lat) / LAT_RANGE) * HEIGHT)


def lonlat_to_xy(lon: float, lat: float) -> tuple[int, int]:
    """Convert (lon, lat) to (x, y) pixel coordinates."""
    return lon_to_x(lon), lat_to_y(lat)


def x_to_lon(x: int) -> float:
    """Convert pixel x to longitude."""
    return LON_MIN + (x / WIDTH) * LON_RANGE


def y_to_lat(y: int) -> float:
    """Convert pixel y to latitude."""
    return LAT_MAX - (y / HEIGHT) * LAT_RANGE


# ---------------------------------------------------------------------------
# Polygon rasterization (scanline fill + ray casting)
# ---------------------------------------------------------------------------

def polygon_to_pixel_coords(
    polygon: list[tuple[float, float]],
) -> list[tuple[int, int]]:
    """Convert list of (lon, lat) tuples to (x, y) pixel coordinates."""
    return [lonlat_to_xy(lon, lat) for lon, lat in polygon]


def point_in_polygon(
    px: float, py: float, polygon: list[tuple[float, float]]
) -> bool:
    """Ray-casting test for point-in-polygon."""
    n = len(polygon)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if ((yi > py) != (yj > py)) and (
            px < (xj - xi) * (py - yi) / (yj - yi) + xi
        ):
            inside = not inside
        j = i
    return inside


def rasterize_polygon(
    mask: np.ndarray,
    polygon: list[tuple[float, float]],
    value: int = 1,
) -> None:
    """Rasterize a polygon defined in (lon, lat) onto a 2D mask using scanline.

    Uses pixel-coordinate conversion and scanline fill for efficiency.
    """
    pixel_poly = polygon_to_pixel_coords(polygon)
    if not pixel_poly:
        return

    # Find bounding box
    xs = [p[0] for p in pixel_poly]
    ys = [p[1] for p in pixel_poly]
    y_min = max(0, min(ys))
    y_max = min(HEIGHT - 1, max(ys))
    x_min = max(0, min(xs))
    x_max = min(WIDTH - 1, max(xs))

    n = len(pixel_poly)

    for y in range(y_min, y_max + 1):
        # Collect x-intersections with polygon edges
        intersections: list[float] = []
        j = n - 1
        for i in range(n):
            xi, yi = pixel_poly[i]
            xj, yj = pixel_poly[j]
            if (yi <= y < yj) or (yj <= y < yi):
                if yj != yi:
                    x_int = xi + (y - yi) * (xj - xi) / (yj - yi)
                    intersections.append(x_int)
            j = i

        intersections.sort()

        # Fill between pairs of intersections
        for k in range(0, len(intersections) - 1, 2):
            x_start = max(x_min, int(math.ceil(intersections[k])))
            x_end = min(x_max, int(math.floor(intersections[k + 1])))
            if x_start <= x_end:
                mask[y, x_start : x_end + 1] = value


def rasterize_polygon_float(
    arr: np.ndarray,
    polygon: list[tuple[float, float]],
    value: float = 1.0,
) -> None:
    """Rasterize polygon onto a float array, setting matching pixels to value."""
    pixel_poly = polygon_to_pixel_coords(polygon)
    if not pixel_poly:
        return

    xs = [p[0] for p in pixel_poly]
    ys = [p[1] for p in pixel_poly]
    y_min = max(0, min(ys))
    y_max = min(HEIGHT - 1, max(ys))
    x_min = max(0, min(xs))
    x_max = min(WIDTH - 1, max(xs))

    n = len(pixel_poly)

    for y in range(y_min, y_max + 1):
        intersections: list[float] = []
        j = n - 1
        for i in range(n):
            xi, yi = pixel_poly[i]
            xj, yj = pixel_poly[j]
            if (yi <= y < yj) or (yj <= y < yi):
                if yj != yi:
                    x_int = xi + (y - yi) * (xj - xi) / (yj - yi)
                    intersections.append(x_int)
            j = i

        intersections.sort()
        for k in range(0, len(intersections) - 1, 2):
            x_start = max(x_min, int(math.ceil(intersections[k])))
            x_end = min(x_max, int(math.floor(intersections[k + 1])))
            if x_start <= x_end:
                arr[y, x_start : x_end + 1] = value


# ---------------------------------------------------------------------------
# Gaussian ridge along a line segment (for mountain ranges)
# ---------------------------------------------------------------------------

def add_mountain_ridge(
    heightmap: np.ndarray,
    points: list[tuple[float, float]],
    peak_height: float,
    width_deg: float,
) -> None:
    """Add a gaussian ridge along a polyline defined by (lon, lat) points.

    peak_height: additional height at the ridge center
    width_deg: width of the gaussian in degrees (sigma)
    """
    # Convert to pixel coordinates
    pixel_pts = [lonlat_to_xy(lon, lat) for lon, lat in points]

    # Compute bounding box with padding
    pad = int(width_deg / LON_RANGE * WIDTH * 3)
    xs = [p[0] for p in pixel_pts]
    ys = [p[1] for p in pixel_pts]
    y_min = max(0, min(ys) - pad)
    y_max = min(HEIGHT - 1, max(ys) + pad)
    x_min = max(0, min(xs) - pad)
    x_max = min(WIDTH - 1, max(xs) + pad)

    # Sigma in pixels
    sigma_x = width_deg / LON_RANGE * WIDTH
    sigma_y = width_deg / LAT_RANGE * HEIGHT

    for y in range(y_min, y_max + 1):
        for x in range(x_min, x_max + 1):
            # Find minimum distance to any line segment
            min_dist_sq = float("inf")
            for i in range(len(pixel_pts) - 1):
                ax, ay = pixel_pts[i]
                bx, by = pixel_pts[i + 1]
                dx, dy = bx - ax, by - ay
                length_sq = dx * dx + dy * dy
                if length_sq == 0:
                    dist_sq = (x - ax) ** 2 + (y - ay) ** 2
                else:
                    t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / length_sq))
                    px = ax + t * dx
                    py = ay + t * dy
                    dist_sq = (x - px) ** 2 + (y - py) ** 2
                if dist_sq < min_dist_sq:
                    min_dist_sq = dist_sq

            # Gaussian falloff using average sigma
            sigma_avg = (sigma_x + sigma_y) / 2
            gaussian = math.exp(-min_dist_sq / (2 * sigma_avg * sigma_avg))
            addition = peak_height * gaussian
            heightmap[y, x] += addition


def add_mountain_ridge_fast(
    heightmap: np.ndarray,
    points: list[tuple[float, float]],
    peak_height: float,
    width_deg: float,
) -> None:
    """Vectorized version of mountain ridge addition using numpy.

    Much faster than the per-pixel loop version.
    """
    pixel_pts = [lonlat_to_xy(lon, lat) for lon, lat in points]

    pad = int(width_deg / LON_RANGE * WIDTH * 3.5)
    xs = [p[0] for p in pixel_pts]
    ys = [p[1] for p in pixel_pts]
    y_min = max(0, min(ys) - pad)
    y_max = min(HEIGHT - 1, max(ys) + pad)
    x_min = max(0, min(xs) - pad)
    x_max = min(WIDTH - 1, max(xs) + pad)

    sigma_x = width_deg / LON_RANGE * WIDTH
    sigma_y = width_deg / LAT_RANGE * HEIGHT
    sigma_avg = (sigma_x + sigma_y) / 2.0

    # Create coordinate grids for the bounding box region
    yy, xx = np.mgrid[y_min : y_max + 1, x_min : x_max + 1]
    yy = yy.astype(np.float64)
    xx = xx.astype(np.float64)

    min_dist_sq = np.full(xx.shape, np.inf)

    for i in range(len(pixel_pts) - 1):
        ax, ay = float(pixel_pts[i][0]), float(pixel_pts[i][1])
        bx, by = float(pixel_pts[i + 1][0]), float(pixel_pts[i + 1][1])
        dx, dy = bx - ax, by - ay
        length_sq = dx * dx + dy * dy

        if length_sq == 0:
            dist_sq = (xx - ax) ** 2 + (yy - ay) ** 2
        else:
            t = ((xx - ax) * dx + (yy - ay) * dy) / length_sq
            t = np.clip(t, 0.0, 1.0)
            px = ax + t * dx
            py = ay + t * dy
            dist_sq = (xx - px) ** 2 + (yy - py) ** 2

        min_dist_sq = np.minimum(min_dist_sq, dist_sq)

    gaussian = np.exp(-min_dist_sq / (2.0 * sigma_avg * sigma_avg))
    addition = peak_height * gaussian
    heightmap[y_min : y_max + 1, x_min : x_max + 1] += addition


# ---------------------------------------------------------------------------
# Landmass Polygons (lon, lat)
# ---------------------------------------------------------------------------

# Mainland Europe (north of Mediterranean, excluding peninsulas defined separately)
EUROPE_MAINLAND = [
    # Western France coast
    (-10.0, 55.0), (-8.0, 55.0), (-5.0, 55.0), (-5.0, 52.0),
    (-5.5, 50.5), (-4.0, 50.0), (-1.5, 49.0), (-2.0, 48.5),
    (-4.5, 48.5), (-4.0, 47.8), (-2.0, 47.2), (-1.2, 46.5),
    (-1.5, 45.5), (-1.0, 44.5),
    # Pyrenees / Spain border
    (-2.0, 43.5), (0.0, 42.8), (3.0, 42.5),
    # Southern France coast
    (3.5, 43.0), (4.0, 43.3), (4.8, 43.4), (5.5, 43.2),
    (6.0, 43.1), (6.8, 43.5), (7.5, 43.7),
    # Liguria to Italy border
    (7.6, 44.2), (7.0, 44.5),
    # Alps / Northern Italy border
    (6.8, 45.8), (7.0, 46.5), (8.0, 47.5), (9.5, 47.3),
    (10.5, 47.5), (12.0, 47.0), (13.0, 46.8), (14.5, 46.5),
    (15.5, 46.0), (16.0, 46.4), (16.5, 46.9),
    # Pannonia / Balkans
    (17.0, 47.8), (18.5, 47.5), (19.0, 47.5),
    (20.0, 47.0), (21.0, 46.5), (22.5, 46.0), (22.5, 45.0),
    # Down the Balkans eastern coast
    (23.0, 44.5), (24.0, 44.0), (25.0, 43.7), (26.0, 43.5),
    (27.5, 43.3), (28.0, 43.0), (28.5, 43.2),
    # Black Sea western coast
    (28.5, 43.5), (28.0, 44.0), (29.0, 44.5),
    (29.5, 45.0), (30.0, 45.5), (30.5, 46.0),
    (31.0, 46.5), (33.0, 46.6), (34.0, 46.0),
    # Crimea (as a bump)
    (33.5, 45.5), (34.0, 45.0), (35.5, 45.3), (36.5, 45.4),
    (36.0, 46.0), (35.0, 46.5), (34.5, 47.0),
    # Ukraine coast
    (36.0, 47.0), (37.5, 47.5), (39.0, 47.2),
    (40.0, 47.5), (42.0, 47.0), (44.0, 47.5),
    # Eastern edge
    (50.0, 47.5), (50.0, 55.0),
    (-10.0, 55.0),
]

# British Isles (partial, southern Britain visible)
BRITAIN = [
    (-5.5, 50.0), (-5.0, 50.5), (-5.5, 51.5), (-5.0, 52.0),
    (-4.0, 52.5), (-3.5, 53.5), (-3.0, 54.5), (-3.5, 55.0),
    (-2.0, 55.0), (-1.5, 54.5), (-0.5, 54.0), (0.0, 53.5),
    (0.5, 53.0), (1.5, 52.8), (1.8, 52.0), (1.0, 51.5),
    (1.5, 51.0), (0.5, 50.8), (-0.5, 50.7), (-1.0, 50.7),
    (-2.0, 50.5), (-3.0, 50.3), (-4.0, 50.3), (-5.0, 50.0),
    (-5.5, 50.0),
]

IRELAND = [
    (-10.0, 51.5), (-10.0, 53.5), (-9.5, 54.0), (-8.0, 55.0),
    (-7.0, 55.3), (-6.0, 55.0), (-6.0, 54.0), (-6.5, 53.5),
    (-6.0, 52.5), (-6.5, 52.0), (-7.5, 51.5), (-9.5, 51.5),
    (-10.0, 51.5),
]

# Italian Peninsula - clean clockwise outline, no self-intersections
# The boot is traced as: north coast (east) -> adriatic (south) -> heel (east) ->
# arch/sole (west) -> toe (south) -> tyrrhenian (north) -> liguria (start)
ITALY = [
    # Po Valley / Northern coast (west to east)
    (7.6, 44.2), (8.2, 44.4), (9.0, 44.5), (10.0, 44.8),
    (11.0, 44.5), (12.0, 44.9), (12.5, 44.5),
    # Adriatic coast (south)
    (13.5, 43.6), (14.0, 42.8), (14.5, 42.0),
    (15.0, 41.5), (15.5, 41.0), (16.0, 40.6),
    # Puglia heel (eastward bulge)
    (16.5, 40.5), (17.5, 40.6), (18.3, 40.2),
    (18.5, 39.9),
    # Instep / Gulf of Taranto (inner arch going west then south)
    (17.8, 39.8), (17.0, 39.9), (16.5, 39.6),
    # Calabria toe (narrow peninsula going south-southwest)
    (16.5, 39.2), (16.2, 38.8), (16.0, 38.4),
    (15.7, 38.0), (15.6, 37.9),
    # Toe tip and around to Tyrrhenian side
    (15.8, 37.9), (16.1, 38.2), (16.2, 38.5),
    # Tyrrhenian coast going north
    (15.8, 38.8), (15.5, 39.3), (15.2, 39.8),
    (14.8, 40.2), (14.5, 40.6), (14.2, 40.8),
    # Naples / Campania
    (14.0, 40.8), (13.5, 41.2), (13.0, 41.2),
    # Western coast going north
    (12.5, 41.5), (11.8, 42.0), (11.2, 42.4),
    (10.5, 42.9), (10.0, 43.5), (9.8, 43.8),
    (9.5, 44.2), (8.5, 44.3),
    # Close at Liguria
    (7.6, 44.2),
]

# Iberian Peninsula
IBERIA = [
    # Northwest corner
    (-10.0, 43.5), (-8.5, 43.8), (-7.5, 43.7),
    (-6.0, 43.5), (-4.5, 43.4), (-3.5, 43.3),
    (-2.0, 43.5),
    # Pyrenees border
    (0.0, 42.8), (1.5, 42.6), (3.0, 42.5),
    # Mediterranean coast
    (3.2, 41.5), (2.0, 41.3), (1.0, 41.0),
    (0.5, 40.5), (0.0, 39.5), (-0.2, 38.8),
    (-0.5, 38.2), (-0.8, 37.8), (-1.5, 37.5),
    (-2.0, 36.8), (-3.0, 36.7), (-4.0, 36.5),
    # Gibraltar
    (-5.3, 36.0), (-5.5, 36.1),
    # Atlantic coast going north
    (-6.5, 36.5), (-7.0, 37.0), (-7.5, 37.2),
    (-8.0, 37.0), (-8.9, 37.5), (-9.0, 38.0),
    (-9.5, 38.7), (-9.0, 39.5), (-9.5, 40.0),
    (-9.0, 40.5), (-8.8, 41.0), (-8.5, 41.5),
    (-8.8, 42.0), (-9.0, 42.5), (-9.5, 43.0),
    (-10.0, 43.5),
]

# Greece / Balkans - clean clockwise outline
# The mainland peninsula from Albania/Macedonia down to the Gulf of Corinth
GREECE_MAINLAND = [
    # Northern border (west to east)
    (20.0, 42.0), (21.0, 41.5), (22.0, 41.0),
    (23.0, 41.0), (24.0, 41.0), (25.0, 41.0),
    (26.0, 40.5),
    # Aegean coast going south
    (25.5, 40.0), (24.5, 39.5), (24.0, 39.0),
    (23.5, 38.8), (23.0, 38.3),
    # Attica (eastward bump)
    (24.0, 38.0), (24.2, 37.8),
    # South to Corinth isthmus area
    (23.5, 37.8), (23.0, 37.9), (22.5, 38.0),
    # Gulf of Corinth north side going west
    (22.0, 38.2), (21.5, 38.3),
    # Western coast going north
    (21.0, 38.5), (20.5, 39.0), (20.5, 39.5),
    (20.0, 40.0), (20.0, 40.5), (19.5, 41.0),
    (20.0, 41.5), (20.0, 42.0),
]

# Peloponnese
PELOPONNESE = [
    (21.5, 38.0), (22.0, 38.2), (22.5, 37.9),
    (23.0, 37.5), (23.2, 37.0), (23.0, 36.5),
    (22.5, 36.4), (22.0, 36.7), (21.5, 36.5),
    (21.3, 36.8), (21.0, 37.0), (21.5, 37.5),
    (21.5, 38.0),
]

# Anatolia / Asia Minor
ANATOLIA = [
    # Northern coast (Black Sea)
    (26.0, 41.5), (27.5, 41.5), (29.0, 41.0),
    (30.5, 41.5), (32.0, 41.8), (33.5, 42.0),
    (35.0, 42.0), (36.5, 41.5), (38.0, 41.0),
    (40.0, 41.0), (41.0, 41.3), (42.0, 41.5),
    # Eastern Turkey
    (44.0, 41.0), (44.5, 40.0), (44.0, 39.0),
    (44.5, 38.0), (44.0, 37.5),
    # Southeast border
    (43.0, 37.0), (42.0, 37.0), (40.0, 37.0),
    (38.0, 36.5), (36.5, 36.5), (36.0, 36.0),
    # Mediterranean coast
    (35.5, 36.0), (34.0, 36.2), (33.0, 36.0),
    (32.0, 36.5), (30.5, 36.3), (29.5, 36.5),
    (28.5, 36.5), (27.5, 36.8), (27.0, 37.0),
    # Aegean coast
    (26.5, 37.5), (26.3, 38.0), (26.5, 38.5),
    (27.0, 39.0), (26.5, 39.5), (26.0, 40.0),
    (26.5, 40.5), (26.0, 41.0), (26.0, 41.5),
]

# North Africa (Morocco to Egypt) - clean clockwise outline
# Traced: coast (east to west) then south edge then east edge
NORTH_AFRICA = [
    # Morocco Atlantic coast going south
    (-5.3, 35.8), (-5.5, 35.5), (-6.0, 34.5),
    (-7.0, 34.0), (-8.0, 33.0), (-9.0, 32.5),
    (-10.0, 32.0), (-10.0, 25.0),
    # Southern edge of map (east)
    (33.0, 25.0),
    # Egypt - Sinai west side going north
    (33.0, 27.5), (32.5, 29.0), (32.0, 30.0),
    (31.5, 30.8), (31.0, 31.3),
    # Nile Delta
    (30.5, 31.5), (30.0, 31.5), (29.5, 31.2),
    # Libya coast (east to west)
    (27.0, 31.2), (25.0, 31.5), (23.5, 31.8),
    (22.0, 32.2), (20.5, 32.5),
    # Gulf of Sidra (indentation - careful clockwise trace)
    (19.5, 32.2), (19.0, 31.5), (18.5, 31.0),
    (17.5, 31.0), (16.5, 31.5), (15.5, 32.0),
    (14.5, 32.5),
    # Tunisia
    (12.0, 33.5), (11.0, 33.8), (10.5, 34.5),
    (10.0, 35.5), (10.2, 36.5), (10.5, 37.0),
    # Cap Bon peninsula
    (11.0, 37.1),
    # Algeria coast (east to west)
    (9.5, 37.0), (8.0, 36.8), (7.0, 36.8),
    (6.0, 36.8), (5.0, 36.5), (4.0, 36.7),
    (3.0, 36.8), (2.0, 36.5), (1.0, 36.3),
    (0.0, 35.8),
    # Morocco coast
    (-1.0, 35.5), (-2.0, 35.3), (-3.0, 35.3),
    (-4.0, 35.2), (-5.0, 35.5), (-5.3, 35.8),
]

# Sinai Peninsula (separate polygon to avoid self-intersection in North Africa)
SINAI = [
    (32.0, 30.0), (32.5, 29.0), (33.0, 27.5),
    (34.2, 27.0), (34.8, 28.0), (34.8, 29.5),
    (34.5, 30.5), (34.0, 31.2), (33.5, 31.5),
    (32.5, 31.5), (32.0, 31.3), (31.5, 30.8),
    (32.0, 30.0),
]

# Levant / Middle East - clean outline, no overlap with North Africa
LEVANT = [
    # Coast from Sinai north
    (34.0, 31.2), (34.5, 31.5), (35.0, 32.0),
    (35.5, 32.5), (35.8, 33.0), (36.0, 33.5),
    (35.8, 34.0), (36.0, 34.5), (36.0, 35.5),
    (36.0, 36.0),
    # Anatolia border going east
    (36.5, 36.5), (38.0, 36.5), (40.0, 37.0),
    (42.0, 37.0), (44.0, 37.0),
    # South through Mesopotamia
    (46.0, 35.0), (47.0, 33.0), (48.0, 31.0),
    (48.0, 29.0), (47.5, 28.5),
    # Arabian coast
    (45.0, 25.0), (40.0, 25.0),
    # Up the Red Sea western coast
    (38.0, 26.0), (36.0, 27.5), (35.0, 28.5),
    (34.8, 29.5), (34.5, 30.5), (34.0, 31.2),
]

# ---------------------------------------------------------------------------
# Islands
# ---------------------------------------------------------------------------

SICILY = [
    (12.4, 38.2), (13.0, 38.2), (14.0, 38.2), (15.2, 38.0),
    (15.5, 37.5), (15.0, 36.8), (14.5, 36.7), (13.5, 37.0),
    (12.5, 37.5), (12.4, 38.0), (12.4, 38.2),
]

SARDINIA = [
    (8.2, 41.2), (9.0, 41.3), (9.7, 41.0), (9.8, 40.5),
    (9.7, 39.5), (9.5, 39.0), (8.5, 38.8), (8.2, 39.0),
    (8.3, 39.5), (8.1, 40.0), (8.0, 40.5), (8.2, 41.0),
    (8.2, 41.2),
]

CORSICA = [
    (8.6, 43.0), (9.4, 43.0), (9.6, 42.5), (9.4, 42.0),
    (9.5, 41.5), (9.2, 41.4), (8.8, 41.5), (8.6, 42.0),
    (8.6, 42.5), (8.6, 43.0),
]

CRETE = [
    (23.5, 35.6), (24.5, 35.6), (25.5, 35.3), (26.3, 35.3),
    (26.3, 35.0), (25.5, 35.0), (24.5, 35.1), (23.5, 35.3),
    (23.5, 35.6),
]

CYPRUS = [
    (32.3, 35.2), (33.0, 35.6), (34.0, 35.7), (34.6, 35.6),
    (34.5, 35.0), (33.5, 34.6), (32.5, 34.8), (32.3, 35.0),
    (32.3, 35.2),
]

# Balearic Islands (Mallorca)
MALLORCA = [
    (2.3, 39.9), (3.0, 39.95), (3.4, 39.8), (3.5, 39.5),
    (3.2, 39.3), (2.6, 39.3), (2.3, 39.5), (2.3, 39.9),
]

# Rhodes
RHODES = [
    (27.8, 36.5), (28.2, 36.5), (28.3, 36.2), (28.1, 36.0),
    (27.8, 36.1), (27.8, 36.5),
]

# Euboea (large island near Athens)
EUBOEA = [
    (23.4, 39.0), (24.0, 38.8), (24.5, 38.5), (24.3, 38.2),
    (23.8, 38.5), (23.4, 38.7), (23.4, 39.0),
]

# Lesbos
LESBOS = [
    (25.8, 39.4), (26.4, 39.4), (26.6, 39.1), (26.3, 39.0),
    (25.8, 39.1), (25.8, 39.4),
]

# ---------------------------------------------------------------------------
# Mountain Ranges (polyline control points + peak height + width)
# ---------------------------------------------------------------------------

MOUNTAINS = {
    "alps": {
        "points": [
            (6.5, 44.2), (7.0, 45.0), (7.5, 45.8), (8.5, 46.5),
            (9.5, 47.0), (10.5, 47.3), (11.5, 47.0), (12.5, 47.0),
            (13.0, 46.5), (14.0, 46.5), (15.0, 46.5), (16.0, 46.5),
        ],
        "peak_height": 85.0,
        "width_deg": 0.8,
    },
    "pyrenees": {
        "points": [
            (-1.5, 43.0), (0.0, 42.7), (1.0, 42.6), (2.0, 42.5),
            (3.0, 42.5),
        ],
        "peak_height": 55.0,
        "width_deg": 0.5,
    },
    "apennines": {
        "points": [
            (8.5, 44.3), (9.5, 44.0), (10.5, 43.5), (11.5, 43.0),
            (12.5, 42.5), (13.5, 42.0), (14.0, 41.5), (15.0, 41.0),
            (15.5, 40.5), (16.0, 39.5), (16.0, 39.0), (15.8, 38.5),
        ],
        "peak_height": 40.0,
        "width_deg": 0.4,
    },
    "atlas": {
        "points": [
            (-5.0, 34.0), (-3.0, 34.5), (-1.0, 34.5), (1.0, 34.5),
            (3.0, 34.5), (5.0, 34.5), (7.0, 34.5), (9.0, 34.0),
        ],
        "peak_height": 50.0,
        "width_deg": 0.8,
    },
    "dinaric_alps": {
        "points": [
            (14.0, 46.0), (15.5, 44.5), (16.5, 44.0), (17.5, 43.5),
            (18.5, 43.0), (19.5, 42.5), (20.0, 42.0), (20.5, 41.5),
        ],
        "peak_height": 40.0,
        "width_deg": 0.5,
    },
    "balkans_rhodope": {
        "points": [
            (22.0, 42.0), (23.0, 42.0), (24.0, 41.5), (25.0, 41.5),
            (26.0, 41.5),
        ],
        "peak_height": 30.0,
        "width_deg": 0.4,
    },
    "carpathians": {
        "points": [
            (17.0, 48.0), (18.5, 48.5), (20.0, 48.5), (22.0, 48.0),
            (24.0, 47.5), (25.5, 47.0), (26.0, 46.5), (26.5, 46.0),
            (26.0, 45.5), (25.0, 45.5), (24.0, 45.5),
        ],
        "peak_height": 40.0,
        "width_deg": 0.5,
    },
    "taurus": {
        "points": [
            (30.0, 37.5), (31.0, 37.0), (32.0, 37.0), (33.0, 37.0),
            (34.0, 37.5), (35.0, 37.5), (36.0, 37.0), (37.0, 37.5),
            (38.0, 38.0), (39.0, 38.5), (40.0, 38.5),
        ],
        "peak_height": 55.0,
        "width_deg": 0.6,
    },
    "pontic_alps": {
        "points": [
            (36.0, 40.5), (37.0, 40.5), (38.0, 40.5), (39.0, 40.5),
            (40.0, 40.5), (41.0, 41.0), (42.0, 41.0),
        ],
        "peak_height": 45.0,
        "width_deg": 0.5,
    },
    "anti_taurus": {
        "points": [
            (36.0, 38.0), (37.0, 38.5), (38.0, 39.0), (39.0, 39.5),
            (40.0, 39.5), (42.0, 39.0), (44.0, 38.5),
        ],
        "peak_height": 50.0,
        "width_deg": 0.5,
    },
    "caucasus": {
        "points": [
            (38.0, 43.0), (40.0, 43.0), (42.0, 43.0), (44.0, 42.5),
            (46.0, 42.0), (48.0, 41.5),
        ],
        "peak_height": 70.0,
        "width_deg": 0.5,
    },
    "pindus_greece": {
        "points": [
            (20.5, 40.0), (21.0, 39.5), (21.5, 39.0), (22.0, 38.5),
        ],
        "peak_height": 30.0,
        "width_deg": 0.3,
    },
    "cantabrian": {
        "points": [
            (-8.0, 43.0), (-6.0, 43.0), (-4.0, 43.0), (-3.0, 43.0),
        ],
        "peak_height": 35.0,
        "width_deg": 0.35,
    },
    "central_spain_meseta": {
        "points": [
            (-5.0, 40.0), (-3.0, 40.0), (-1.0, 40.0), (0.0, 40.0),
        ],
        "peak_height": 18.0,
        "width_deg": 1.2,
    },
    "sierra_nevada": {
        "points": [
            (-3.5, 37.0), (-2.5, 37.0), (-1.5, 37.5),
        ],
        "peak_height": 30.0,
        "width_deg": 0.3,
    },
    "lebanon_range": {
        "points": [
            (35.7, 33.0), (36.0, 34.0), (36.0, 34.5),
        ],
        "peak_height": 35.0,
        "width_deg": 0.3,
    },
    "zagros": {
        "points": [
            (44.5, 38.5), (46.0, 37.0), (47.0, 35.0), (48.0, 33.0),
            (49.0, 31.0), (50.0, 29.0),
        ],
        "peak_height": 50.0,
        "width_deg": 0.7,
    },
    "scottish_highlands": {
        "points": [
            (-5.0, 55.0), (-4.0, 54.5), (-3.5, 54.0),
        ],
        "peak_height": 15.0,
        "width_deg": 0.4,
    },
}


# ---------------------------------------------------------------------------
# Ocean depth basins
# ---------------------------------------------------------------------------

OCEAN_BASINS = [
    # (center_lon, center_lat, radius_deg, depth_value)
    # Western Mediterranean
    (5.0, 38.0, 5.0, 8),
    # Eastern Mediterranean (deeper)
    (20.0, 35.0, 6.0, 5),
    # Ionian Sea
    (17.0, 36.0, 3.0, 4),
    # Tyrrhenian Sea
    (12.0, 39.5, 2.5, 10),
    # Adriatic (shallower)
    (15.0, 43.0, 2.0, 18),
    # Aegean (moderate)
    (25.0, 38.0, 2.5, 12),
    # Black Sea (shallow to moderate)
    (34.0, 43.0, 4.0, 14),
    # Atlantic
    (-5.0, 42.0, 8.0, 3),
    # Bay of Biscay
    (-5.0, 46.0, 3.0, 6),
    # North Sea (shallow)
    (3.0, 54.0, 4.0, 20),
    # English Channel
    (-1.0, 50.0, 2.0, 22),
    # Red Sea (narrow, moderate depth)
    (38.0, 25.0, 3.0, 10),
]

# ---------------------------------------------------------------------------
# Water bodies to carve out (seas within landmasses)
# ---------------------------------------------------------------------------

# Black Sea
BLACK_SEA = [
    (27.5, 41.5), (28.5, 43.2), (28.5, 43.5), (28.0, 44.0),
    (29.0, 44.5), (29.5, 45.0), (30.0, 45.5), (31.0, 46.5),
    (33.0, 46.6), (34.0, 46.0), (33.5, 45.5), (34.0, 45.0),
    (35.5, 45.3), (36.5, 45.4), (36.0, 46.0), (37.5, 47.0),
    (39.5, 47.0), (41.5, 46.5), (41.5, 42.5), (41.0, 41.3),
    (40.0, 41.0), (38.0, 41.0), (36.5, 41.5), (35.0, 42.0),
    (33.5, 42.0), (32.0, 41.8), (30.5, 41.5), (29.0, 41.0),
    (27.5, 41.5),
]

# Caspian Sea (partial, eastern edge)
CASPIAN_SEA = [
    (47.0, 47.0), (48.0, 46.0), (49.0, 44.5), (50.0, 43.0),
    (50.0, 40.0), (49.5, 38.5), (49.0, 37.5), (50.0, 37.0),
    (50.0, 47.0), (47.0, 47.0),
]

# Red Sea
RED_SEA = [
    (32.5, 30.0), (33.0, 28.0), (33.5, 27.5), (34.5, 27.0),
    (35.0, 27.5), (35.5, 28.0), (36.0, 28.5), (38.0, 26.0),
    (43.0, 25.0), (43.5, 25.0),
    (43.0, 25.5), (37.5, 26.5), (35.5, 28.5), (34.5, 29.5),
    (34.5, 30.5), (33.5, 30.5), (33.0, 29.5), (32.5, 30.0),
]

# Persian Gulf (partial)
PERSIAN_GULF = [
    (48.0, 30.5), (49.5, 29.0), (50.0, 28.0), (50.0, 25.0),
    (49.0, 25.0), (48.5, 26.5), (48.0, 27.5), (47.5, 29.0),
    (48.0, 30.0), (48.0, 30.5),
]

# Sea of Marmara
MARMARA = [
    (26.5, 41.0), (27.0, 41.0), (28.0, 41.0), (29.0, 41.0),
    (29.5, 40.7), (29.0, 40.5), (28.0, 40.5), (27.0, 40.6),
    (26.5, 40.7), (26.5, 41.0),
]

# Sea of Azov
AZOV = [
    (35.0, 46.0), (36.5, 46.3), (38.0, 46.0), (39.5, 46.5),
    (39.5, 45.5), (37.5, 45.0), (36.5, 45.5), (35.5, 45.5),
    (35.0, 46.0),
]


# ---------------------------------------------------------------------------
# Province definitions (approximate polygon boundaries in lon/lat)
# ---------------------------------------------------------------------------

# Province capitals (lon, lat) - used for nearest-neighbor assignment
PROVINCE_CAPITALS = {
    1: (23.7, 37.97),    # Achaea - Athens
    2: (29.9, 31.2),     # Aegyptus - Alexandria
    3: (10.3, 36.8),     # Africa Proconsularis - Carthage
    4: (6.8, 45.1),      # Alpes Cottiae - Segusio
    5: (7.0, 45.8),      # Alpes Graiae et Poeninae
    6: (7.3, 43.7),      # Alpes Maritimae - Cemenelum
    7: (35.4, 30.3),     # Arabia - Petra
    8: (44.5, 40.0),     # Armenia - Artaxata
    9: (27.3, 37.9),     # Asia - Ephesus
    10: (43.0, 36.3),    # Assyria - Nineveh
    11: (-4.8, 37.9),    # Baetica - Corduba
    12: (29.9, 40.8),    # Bithynia et Pontus - Nicomedia
    13: (-0.1, 51.5),    # Britannia - Londinium
    14: (32.8, 39.9),    # Cappadocia et Galatia - Ancyra
    15: (34.9, 37.0),    # Cilicia et Cyprus - Tarsus
    16: (9.1, 39.2),     # Corsica et Sardinia - Caralis
    17: (24.5, 35.1),    # Creta et Cyrenaica - Gortyna
    18: (22.8, 45.9),    # Dacia - Sarmizegetusa
    19: (16.4, 43.5),    # Dalmatia - Salona
    20: (-0.6, 44.8),    # Gallia Aquitania - Burdigala
    21: (6.0, 49.6),     # Gallia Belgica - Augusta Treverorum
    22: (4.8, 45.8),     # Gallia Lugdunensis - Lugdunum
    23: (3.0, 43.2),     # Gallia Narbonensis - Narbo
    24: (6.9, 51.0),     # Germania Inferior - Colonia Agrippina
    25: (8.3, 50.0),     # Germania Superior - Mogontiacum
    26: (1.2, 41.1),     # Hispania Tarraconensis - Tarraco
    27: (12.5, 41.9),    # Italia - Roma
    28: (-7.5, 38.9),    # Lusitania - Emerita Augusta
    29: (22.9, 40.6),    # Macedonia - Thessalonica
    30: (2.2, 36.6),     # Mauretania Caesariensis - Caesarea
    31: (-5.8, 35.8),    # Mauretania Tingitana - Tingis
    32: (44.4, 33.3),    # Mesopotamia - Ctesiphon
    33: (28.6, 44.2),    # Moesia Inferior - Tomis
    34: (20.5, 44.8),    # Moesia Superior - Singidunum
    35: (14.4, 46.8),    # Noricum - Virunum
    36: (18.0, 47.5),    # Pannonia Inferior - Aquincum
    37: (16.5, 48.0),    # Pannonia Superior - Carnuntum
    38: (10.9, 48.4),    # Raetia - Augusta Vindelicorum
    39: (15.3, 37.1),    # Sicilia - Syracuse
    40: (36.3, 33.5),    # Syria - Damascus
    41: (29.0, 41.0),    # Thracia - Byzantium
}

# Empire boundary polygon (very approximate)
# Tiles inside this polygon AND on land get a province ID > 0
EMPIRE_BOUNDARY = [
    # Britain
    (-5.5, 55.0), (-5.5, 50.0), (-0.5, 50.5), (1.8, 51.0),
    (1.8, 53.0), (-0.5, 55.0), (-5.5, 55.0),
    # Gap - mainland below
]

# Rather than a single polygon, we define the empire as a set of
# latitude/longitude bounds per province region. The nearest-neighbor
# to capital approach works better for our purposes.

# Empire extent (approximate bounding polygon for the entire empire)
EMPIRE_EXTENT = [
    # Northwestern Britain
    (-5.5, 55.0), (-0.5, 55.0), (1.8, 52.0),
    # Cross channel to Gaul
    (2.0, 51.0), (6.0, 51.5), (8.0, 51.0),
    # Rhine frontier
    (9.0, 51.0), (9.5, 50.0), (10.0, 49.0),
    # Danube frontier
    (12.0, 48.5), (15.0, 48.0), (17.0, 48.5),
    (18.5, 48.5), (20.0, 47.5), (21.0, 47.0),
    # Dacia (north of Danube)
    (22.5, 48.0), (25.0, 48.0), (27.0, 47.5),
    (28.5, 46.5), (29.0, 45.0),
    # Black Sea coast
    (29.0, 44.0), (30.0, 43.5), (31.0, 42.5),
    (33.0, 42.0), (35.0, 42.0),
    # Eastern Anatolia
    (38.0, 41.5), (40.0, 41.5), (42.0, 41.5),
    (44.5, 41.0), (44.5, 40.0),
    # Armenia / Mesopotamia extent
    (44.5, 38.0), (44.5, 37.0), (44.0, 36.0),
    (44.0, 34.0), (44.5, 33.0),
    # Persian Gulf direction - Mesopotamia
    (47.0, 31.0), (46.0, 30.0),
    # Arabia
    (38.0, 27.0), (35.5, 28.0), (34.5, 29.5),
    # Egypt (Nile Valley)
    (34.5, 31.0), (33.0, 31.0), (30.0, 31.5),
    (30.0, 25.0),
    # Libya / Cyrenaica coast
    (25.0, 30.5), (23.0, 31.5), (20.0, 32.0),
    # Africa Proconsularis / Tunisia
    (12.0, 33.0), (10.0, 34.0),
    # Algeria coast (Mauretania Caesariensis)
    (5.0, 35.5), (2.0, 35.5), (0.0, 35.0),
    # Morocco (Mauretania Tingitana)
    (-5.5, 35.5), (-6.0, 34.0), (-6.0, 33.0),
    (-5.0, 32.0), (-3.0, 31.5),
    # Back across sea to Iberia
    (-5.5, 36.0),
    # Iberian Peninsula
    (-10.0, 36.5), (-10.0, 43.5),
    # Atlantic coast of France
    (-4.5, 48.5), (-5.0, 50.0), (-5.5, 50.5),
    (-5.5, 55.0),
]

# Separate Britain empire boundary
EMPIRE_BRITAIN = [
    (-5.5, 50.0), (-5.0, 50.5), (-5.5, 51.5), (-5.0, 52.0),
    (-4.0, 52.5), (-3.5, 53.5), (-3.0, 54.5), (-3.5, 55.0),
    (-0.5, 55.0), (0.0, 53.5), (1.5, 52.8), (1.8, 52.0),
    (1.5, 51.0), (0.5, 50.8), (-1.0, 50.7), (-3.0, 50.3),
    (-5.0, 50.0), (-5.5, 50.0),
]


# ---------------------------------------------------------------------------
# Main generation functions
# ---------------------------------------------------------------------------

def create_land_mask() -> np.ndarray:
    """Create a boolean land mask from polygon definitions."""
    print("  Creating land mask from polygons...")
    mask = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)

    landmasses = [
        ("Europe mainland", EUROPE_MAINLAND),
        ("Italian Peninsula", ITALY),
        ("Iberian Peninsula", IBERIA),
        ("Greece mainland", GREECE_MAINLAND),
        ("Peloponnese", PELOPONNESE),
        ("Anatolia", ANATOLIA),
        ("North Africa", NORTH_AFRICA),
        ("Sinai", SINAI),
        ("Levant", LEVANT),
        ("Britain", BRITAIN),
        ("Ireland", IRELAND),
        ("Sicily", SICILY),
        ("Sardinia", SARDINIA),
        ("Corsica", CORSICA),
        ("Crete", CRETE),
        ("Cyprus", CYPRUS),
        ("Mallorca", MALLORCA),
        ("Rhodes", RHODES),
        ("Euboea", EUBOEA),
        ("Lesbos", LESBOS),
    ]

    for name, polygon in landmasses:
        print(f"    Rasterizing {name}...")
        rasterize_polygon(mask, polygon, value=1)

    return mask


def carve_water_bodies(mask: np.ndarray) -> None:
    """Remove inland water bodies from the land mask."""
    print("  Carving water bodies...")

    water_bodies = [
        ("Black Sea", BLACK_SEA),
        ("Caspian Sea", CASPIAN_SEA),
        ("Red Sea", RED_SEA),
        ("Persian Gulf", PERSIAN_GULF),
        ("Sea of Marmara", MARMARA),
        ("Sea of Azov", AZOV),
    ]

    for name, polygon in water_bodies:
        print(f"    Carving {name}...")
        rasterize_polygon(mask, polygon, value=0)


def create_ocean_depth(land_mask: np.ndarray) -> np.ndarray:
    """Create ocean depth values for non-land areas."""
    print("  Generating ocean depths...")
    depth = np.full((HEIGHT, WIDTH), 15.0, dtype=np.float64)

    # Apply basin depth variations
    for center_lon, center_lat, radius, depth_val in OCEAN_BASINS:
        cx, cy = lonlat_to_xy(center_lon, center_lat)
        r_pixels = int(radius / LON_RANGE * WIDTH)

        y_min = max(0, cy - r_pixels * 2)
        y_max = min(HEIGHT, cy + r_pixels * 2)
        x_min = max(0, cx - r_pixels * 2)
        x_max = min(WIDTH, cx + r_pixels * 2)

        yy, xx = np.mgrid[y_min:y_max, x_min:x_max]
        dist = np.sqrt(((xx - cx) / r_pixels) ** 2 + ((yy - cy) / r_pixels) ** 2)

        influence = np.exp(-dist ** 2 * 0.5)
        depth[y_min:y_max, x_min:x_max] = np.where(
            influence > 0.01,
            depth[y_min:y_max, x_min:x_max] * (1 - influence) + depth_val * influence,
            depth[y_min:y_max, x_min:x_max],
        )

    # Mask to ocean only
    depth = np.where(land_mask == 0, depth, 0)
    return depth


def create_base_land_height(land_mask: np.ndarray) -> np.ndarray:
    """Create base land elevation (flatlands)."""
    print("  Setting base land elevations...")
    height = np.zeros((HEIGHT, WIDTH), dtype=np.float64)

    # Base land height with slight variation
    ys, xs = np.mgrid[0:HEIGHT, 0:WIDTH]
    lons = LON_MIN + (xs / WIDTH) * LON_RANGE
    lats = LAT_MAX - (ys / HEIGHT) * LAT_RANGE

    # Slight base height variation based on distance from coast
    # Higher inland, lower near coast
    base = np.where(land_mask == 1, LAND_BASE + 2.0, 0.0)

    # Add gentle continental-scale variation
    continental_var = (
        3.0 * np.sin(lons * 0.15) * np.cos(lats * 0.12)
        + 2.0 * np.sin(lons * 0.08 + 1.0) * np.cos(lats * 0.1 + 0.5)
    )
    base = np.where(land_mask == 1, base + continental_var, base)

    return base


def add_mountains(heightmap: np.ndarray) -> None:
    """Add mountain ranges as gaussian ridges."""
    print("  Adding mountain ranges...")
    for name, params in MOUNTAINS.items():
        print(f"    Adding {name}...")
        add_mountain_ridge_fast(
            heightmap,
            params["points"],
            params["peak_height"],
            params["width_deg"],
        )


def add_coastal_gradient(
    heightmap: np.ndarray, land_mask: np.ndarray
) -> np.ndarray:
    """Add smooth transition at coastlines."""
    print("  Adding coastal gradients...")

    from scipy.ndimage import distance_transform_edt  # type: ignore

    # Distance from coast (in pixels) for land tiles
    land_dist = distance_transform_edt(land_mask)
    # Distance from coast for ocean tiles
    ocean_dist = distance_transform_edt(1 - land_mask)

    # Coastal gradient: smooth transition over ~5 pixels
    coastal_width = 8.0

    # For land: reduce height near coast
    land_factor = np.clip(land_dist / coastal_width, 0, 1)
    # For ocean: increase depth away from coast
    ocean_factor = np.clip(ocean_dist / coastal_width, 0, 1)

    return land_dist, ocean_dist, land_factor, ocean_factor


def generate_heightmap() -> np.ndarray:
    """Generate the complete 2048x2048 heightmap."""
    print("=" * 60)
    print("Generating Mediterranean heightmap (2048x2048)")
    print("=" * 60)

    # Step 1: Land mask
    land_mask = create_land_mask()
    carve_water_bodies(land_mask)
    land_count = np.sum(land_mask)
    ocean_count = WIDTH * HEIGHT - land_count
    print(f"  Land tiles: {land_count:,} ({100*land_count/(WIDTH*HEIGHT):.1f}%)")
    print(f"  Ocean tiles: {ocean_count:,} ({100*ocean_count/(WIDTH*HEIGHT):.1f}%)")

    # Step 2: Ocean depth
    ocean_depth = create_ocean_depth(land_mask)

    # Step 3: Base land height
    heightmap = create_base_land_height(land_mask)

    # Step 4: Mountains
    add_mountains(heightmap)

    # Step 5: Coastal gradient using distance transform
    print("  Computing distance transforms...")
    try:
        from scipy.ndimage import distance_transform_edt
        land_dist = distance_transform_edt(land_mask)
        ocean_dist = distance_transform_edt(1 - land_mask)
    except ImportError:
        print("  scipy not available, using manual distance approximation...")
        land_dist = _manual_distance_transform(land_mask)
        ocean_dist = _manual_distance_transform(1 - land_mask)

    coastal_width = 6.0

    # Land: smooth ramp from coast to interior
    land_factor = np.clip(land_dist / coastal_width, 0.0, 1.0)

    # Apply coastal gradient to land heights
    # At the very coast, height should be COAST_HEIGHT (34)
    # Further inland, full base height + mountains
    land_heights = heightmap * land_factor + COAST_HEIGHT * (1.0 - land_factor)
    land_heights = np.where(land_mask == 1, land_heights, 0)

    # Ocean depth: smoothly transition from WATER_LEVEL near coast to deep
    ocean_factor = np.clip(ocean_dist / coastal_width, 0.0, 1.0)
    ocean_heights = WATER_LEVEL * (1.0 - ocean_factor) + ocean_depth * ocean_factor
    ocean_heights = np.where(land_mask == 0, ocean_heights, 0)

    # Combine
    final = land_heights + ocean_heights

    # Step 6: Smoothing
    print("  Applying gaussian smoothing...")
    try:
        from scipy.ndimage import gaussian_filter
        final = gaussian_filter(final, sigma=1.5)
    except ImportError:
        final = _manual_smooth(final, passes=2)

    # Re-enforce land/ocean boundary after smoothing
    # Land pixels must be >= WATER_LEVEL + 1
    final = np.where(
        land_mask == 1,
        np.maximum(final, WATER_LEVEL + 1),
        np.minimum(final, WATER_LEVEL),
    )

    # Clamp to valid range [0, 127]
    final = np.clip(final, 0, 127).astype(np.uint8)

    print(f"  Height range: {final.min()} to {final.max()}")
    print(f"  Mean land height: {final[land_mask == 1].mean():.1f}")
    print(f"  Mean ocean depth: {final[land_mask == 0].mean():.1f}")

    return final


def _manual_distance_transform(binary: np.ndarray) -> np.ndarray:
    """Approximate distance transform without scipy.

    Uses iterative erosion to estimate distance from edge.
    Not as accurate as EDT but works for coastal gradients.
    """
    dist = np.zeros_like(binary, dtype=np.float64)
    current = binary.copy()
    d = 0
    while current.any():
        d += 1
        # Erode by 1 pixel (4-connected)
        eroded = np.zeros_like(current)
        eroded[1:, :] &= current[:-1, :]
        eroded[:-1, :] &= current[1:, :]
        eroded[:, 1:] &= current[:, :-1]
        eroded[:, :-1] &= current[:, 1:]
        # Actually need proper erosion
        eroded = (
            current[1:, :].astype(np.int8)
            + current[:-1, :].astype(np.int8)
            + current[:, 1:].astype(np.int8)
            + current[:, :-1].astype(np.int8)
        )
        # Simplified: just use a basic approach
        break

    # Fallback: box filter approximation
    from PIL import ImageFilter

    img = Image.fromarray((binary * 255).astype(np.uint8))
    blurred = img.filter(ImageFilter.GaussianBlur(radius=6))
    dist = np.array(blurred, dtype=np.float64) / 255.0 * 10.0
    return dist


def _manual_smooth(arr: np.ndarray, passes: int = 2) -> np.ndarray:
    """Simple box-filter smoothing without scipy."""
    result = arr.copy()
    for _ in range(passes):
        padded = np.pad(result, 1, mode="edge")
        result = (
            padded[:-2, :-2] + padded[:-2, 1:-1] + padded[:-2, 2:]
            + padded[1:-1, :-2] + padded[1:-1, 1:-1] + padded[1:-1, 2:]
            + padded[2:, :-2] + padded[2:, 1:-1] + padded[2:, 2:]
        ) / 9.0
    return result


# ---------------------------------------------------------------------------
# Province map generation
# ---------------------------------------------------------------------------

def generate_province_map(land_mask: np.ndarray) -> np.ndarray:
    """Generate province ID map using nearest-neighbor to capital cities.

    Province assignment:
    1. Only land tiles within the Roman Empire boundary get a province > 0
    2. Assignment is by nearest province capital (Euclidean in lon/lat space)
    3. Non-empire land and ocean tiles get province 0
    """
    print("=" * 60)
    print("Generating province map (2048x2048)")
    print("=" * 60)

    province_map = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)

    # Create empire mask from boundary polygon
    print("  Rasterizing empire boundary...")
    empire_mask = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    rasterize_polygon(empire_mask, EMPIRE_EXTENT, value=1)
    rasterize_polygon(empire_mask, EMPIRE_BRITAIN, value=1)

    # Only assign provinces to land tiles within empire
    assignable = (land_mask == 1) & (empire_mask == 1)
    assign_count = np.sum(assignable)
    print(f"  Assignable tiles: {assign_count:,}")

    # Convert province capitals to pixel coordinates
    print("  Computing nearest-neighbor province assignment...")
    capital_pixels = {}
    for pid, (lon, lat) in PROVINCE_CAPITALS.items():
        capital_pixels[pid] = lonlat_to_xy(lon, lat)

    # Create coordinate grids
    ys, xs = np.mgrid[0:HEIGHT, 0:WIDTH]

    # For each province capital, compute distance to all pixels
    # Then assign the closest province
    min_dist = np.full((HEIGHT, WIDTH), np.inf, dtype=np.float64)

    for pid, (cx, cy) in capital_pixels.items():
        dist = np.sqrt((xs.astype(np.float64) - cx) ** 2 + (ys.astype(np.float64) - cy) ** 2)
        closer = dist < min_dist
        province_map = np.where(closer & assignable, pid, province_map)
        min_dist = np.where(closer, dist, min_dist)

    # Ensure non-assignable tiles are province 0
    province_map = np.where(assignable, province_map, 0)

    # Count provinces
    unique, counts = np.unique(province_map, return_counts=True)
    print(f"  Province IDs assigned: {len(unique)} unique values")
    for pid, count in zip(unique, counts):
        if pid > 0 and count > 100:
            name = _province_name(pid)
            print(f"    Province {pid:2d} ({name}): {count:,} tiles")

    return province_map


def _province_name(pid: int) -> str:
    """Return province name by ID."""
    names = {
        0: "Barbarian",
        1: "Achaea", 2: "Aegyptus", 3: "Africa Proconsularis",
        4: "Alpes Cottiae", 5: "Alpes Graiae et Poeninae",
        6: "Alpes Maritimae", 7: "Arabia", 8: "Armenia",
        9: "Asia", 10: "Assyria", 11: "Baetica",
        12: "Bithynia et Pontus", 13: "Britannia",
        14: "Cappadocia et Galatia", 15: "Cilicia et Cyprus",
        16: "Corsica et Sardinia", 17: "Creta et Cyrenaica",
        18: "Dacia", 19: "Dalmatia", 20: "Gallia Aquitania",
        21: "Gallia Belgica", 22: "Gallia Lugdunensis",
        23: "Gallia Narbonensis", 24: "Germania Inferior",
        25: "Germania Superior", 26: "Hispania Tarraconensis",
        27: "Italia", 28: "Lusitania", 29: "Macedonia",
        30: "Mauretania Caesariensis", 31: "Mauretania Tingitana",
        32: "Mesopotamia", 33: "Moesia Inferior", 34: "Moesia Superior",
        35: "Noricum", 36: "Pannonia Inferior", 37: "Pannonia Superior",
        38: "Raetia", 39: "Sicilia", 40: "Syria", 41: "Thracia",
    }
    return names.get(pid, f"Unknown({pid})")


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def save_heightmap(heightmap: np.ndarray, output_path: Path) -> None:
    """Save heightmap as grayscale PNG."""
    print(f"  Saving heightmap to {output_path}")
    img = Image.fromarray(heightmap, mode="L")
    img.save(str(output_path))
    file_size = output_path.stat().st_size
    print(f"  File size: {file_size / 1024:.1f} KB")


def save_province_map(province_map: np.ndarray, output_path: Path) -> None:
    """Save province map as RGB PNG (province ID in RED channel)."""
    print(f"  Saving province map to {output_path}")
    rgb = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    rgb[:, :, 0] = province_map  # RED channel = Province-ID
    img = Image.fromarray(rgb, mode="RGB")
    img.save(str(output_path))
    file_size = output_path.stat().st_size
    print(f"  File size: {file_size / 1024:.1f} KB")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    """Generate heightmap and province map for the Mediterranean region."""
    print()
    print("Roma Aeterna - Heightmap & Province Map Generator")
    print("Coordinate range: lon [-10, 50], lat [25, 55]")
    print(f"Output size: {WIDTH}x{HEIGHT} pixels")
    print(f"Sea level (WATER_LEVEL): {WATER_LEVEL}")
    print()

    # Ensure output directory exists
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Output directory: {OUTPUT_DIR}")
    print()

    # Generate heightmap
    heightmap = generate_heightmap()
    heightmap_path = OUTPUT_DIR / "mediterranean.png"
    save_heightmap(heightmap, heightmap_path)
    print()

    # Extract land mask for province generation (from the heightmap itself)
    land_mask = (heightmap > WATER_LEVEL).astype(np.uint8)

    # Generate province map
    province_map = generate_province_map(land_mask)
    province_path = OUTPUT_DIR / "provinces.png"
    save_province_map(province_map, province_path)
    print()

    print("=" * 60)
    print("Generation complete!")
    print(f"  Heightmap: {heightmap_path}")
    print(f"  Provinces: {province_path}")
    print("=" * 60)


if __name__ == "__main__":
    main()
