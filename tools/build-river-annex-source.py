"""Build the compact raw-HydroRIVERS source used by river annex matching.

The committed v0.12.3 package is the last runtime package that retains the
selected HydroRIVERS source vertices.  This tool decodes its v3 packs and
keeps only logical rivers that approach a Natural Earth shared country border.
The output is never rendered; it is a candidate-computation companion asset.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import struct
from collections import defaultdict
from pathlib import Path
from typing import Any

from shapely.geometry import LineString, box, shape
from shapely.ops import transform
from shapely.strtree import STRtree


ROOT = Path(__file__).parents[1]
MICRO = 1_000_000
EARTH_KM_PER_DEGREE = 111.1950802335329


def read_uvarint(payload: bytes, cursor: list[int]) -> int:
    value = 0
    shift = 0
    while cursor[0] < len(payload):
        byte = payload[cursor[0]]
        cursor[0] += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value
        shift += 7
        if shift > 35:
            raise ValueError("invalid hydro varint")
    raise ValueError("truncated hydro varint")


def read_svarint(payload: bytes, cursor: list[int]) -> int:
    value = read_uvarint(payload, cursor)
    return (value >> 1) ^ -(value & 1)


def read_line(payload: bytes, cursor: list[int]) -> list[list[float]]:
    count = read_uvarint(payload, cursor)
    x = y = 0
    points: list[list[float]] = []
    for index in range(count):
        if index == 0:
            x = read_svarint(payload, cursor)
            y = read_svarint(payload, cursor)
        else:
            x += read_svarint(payload, cursor)
            y += read_svarint(payload, cursor)
        points.append([x / MICRO, y / MICRO])
    return points


def read_line_geometry(payload: bytes, geometry_kind: int) -> list[list[list[float]]]:
    cursor = [0]
    count = read_uvarint(payload, cursor)
    parts = [read_line(payload, cursor) for _ in range(count)]
    if geometry_kind not in (1, 2):
        return []
    return [part for part in parts if len(part) >= 2]


def read_source_ids(payload: bytes) -> list[str]:
    if not payload:
        return []
    cursor = [0]
    count = read_uvarint(payload, cursor)
    source_id = read_uvarint(payload, cursor) if count else 0
    output = []
    for index in range(count):
        if index:
            source_id += read_svarint(payload, cursor)
        output.append(str(source_id))
    return output


def decode_index(path: Path) -> tuple[dict[int, list[int]], dict[int, dict[str, int]]]:
    payload = gzip.decompress(path.read_bytes())
    if struct.unpack_from("<I", payload, 0)[0] != 0x33495741 or struct.unpack_from("<H", payload, 4)[0] != 3:
        raise ValueError("v0.12.3 hydro index expected")
    tile_count, logical_count, pack_count = struct.unpack_from("<III", payload, 8)
    offset = 20
    for _ in range(tile_count):
        count = struct.unpack_from("<H", payload, offset + 5)[0]
        offset += 7 + count * 4
    logical_packs: dict[int, list[int]] = {}
    for _ in range(logical_count):
        logical_id = struct.unpack_from("<I", payload, offset)[0]
        count = struct.unpack_from("<H", payload, offset + 4)[0]
        offset += 6
        logical_packs[logical_id] = list(struct.unpack_from(f"<{count}I", payload, offset)) if count else []
        offset += count * 4
    packs: dict[int, dict[str, int]] = {}
    for _ in range(pack_count):
        pack_id = struct.unpack_from("<I", payload, offset)[0]
        shard = struct.unpack_from("<H", payload, offset + 4)[0]
        pack_offset, length = struct.unpack_from("<II", payload, offset + 6)
        stage = payload[offset + 14]
        packs[pack_id] = {"shard": shard, "offset": pack_offset, "length": length, "stage": stage}
        offset += 15
    if offset != len(payload):
        raise ValueError("unexpected bytes in hydro index")
    return logical_packs, packs


def decode_pack(payload: bytes) -> list[dict[str, Any]]:
    if struct.unpack_from("<I", payload, 0)[0] != 0x46485741 or struct.unpack_from("<H", payload, 4)[0] != 3:
        raise ValueError("v3 hydro pack expected")
    count = struct.unpack_from("<I", payload, 8)[0]
    offset = 12
    output: list[dict[str, Any]] = []
    for _ in range(count):
        fid, logical_id = struct.unpack_from("<II", payload, offset)
        kind = payload[offset + 8]
        geometry_kind = payload[offset + 10]
        fragment_index, fragment_count = struct.unpack_from("<HH", payload, offset + 12)
        lengths = struct.unpack_from("<5H", payload, offset + 36)
        source_length, geometry_length, width_length = struct.unpack_from("<III", payload, offset + 46)
        offset += 58
        strings = []
        for length in lengths:
            strings.append(payload[offset:offset + length].decode("utf-8"))
            offset += length
        source_payload = payload[offset:offset + source_length]
        offset += source_length
        geometry_payload = payload[offset:offset + geometry_length]
        offset += geometry_length + width_length
        if kind != 1:
            continue
        parts = read_line_geometry(geometry_payload, geometry_kind)
        if not parts:
            continue
        source_ids = read_source_ids(source_payload)
        if not source_ids and strings[2]:
            source_ids = [value for value in strings[2].split(",") if value]
        output.append({
            "fid": fid,
            "logicalId": logical_id,
            "fragmentIndex": fragment_index,
            "fragmentCount": fragment_count,
            "id": strings[0],
            "name": strings[1],
            "sourceIds": source_ids,
            "parts": parts,
        })
    if offset != len(payload):
        raise ValueError("unexpected bytes in hydro pack")
    return output


def decode_raw_rivers(source: Path) -> dict[int, dict[str, Any]]:
    _, pack_specs = decode_index(source / "index.bin.gz")
    shards: dict[int, bytes] = {}
    logical: dict[int, dict[str, Any]] = {}
    for pack_id, spec in sorted(pack_specs.items()):
        shard_id = spec["shard"]
        if shard_id not in shards:
            shards[shard_id] = (source / "shards" / f"s{shard_id}.bin").read_bytes()
        compressed = shards[shard_id][spec["offset"]:spec["offset"] + spec["length"]]
        for feature in decode_pack(gzip.decompress(compressed)):
            row = logical.setdefault(feature["logicalId"], {
                "id": feature["id"], "name": feature["name"], "parts": [], "sourceIds": set(), "fragments": [],
            })
            row["parts"].extend(feature["parts"])
            row["sourceIds"].update(feature["sourceIds"])
            row["fragments"].append(feature["fragmentIndex"])
    return logical


def iter_lines(geometry: Any):
    if geometry.is_empty:
        return
    if geometry.geom_type in ("LineString", "LinearRing"):
        yield LineString(geometry.coords)
        return
    for item in getattr(geometry, "geoms", []):
        yield from iter_lines(item)


def shared_country_borders(countries_path: Path) -> list[LineString]:
    collection = json.loads(countries_path.read_text(encoding="utf-8"))
    countries = [shape(feature["geometry"]) for feature in collection.get("features", [])]
    tree = STRtree(countries)
    borders: list[LineString] = []
    for left_index, country in enumerate(countries):
        for candidate in tree.query(country):
            right_index = int(candidate)
            if right_index <= left_index:
                continue
            for line in iter_lines(country.boundary.intersection(countries[right_index].boundary)):
                if not line.is_empty and line.length > 1e-10:
                    borders.append(line)
    return borders


def projector(center_latitude: float):
    cos_lat = max(1e-6, math.cos(math.radians(center_latitude)))

    def project(x, y, z=None):
        return x * EARTH_KM_PER_DEGREE * cos_lat, y * EARTH_KM_PER_DEGREE

    return project


def river_near_shared_border(parts: list[list[list[float]]], borders: list[LineString], tree: STRtree, corridor_km: float) -> bool:
    for points in parts:
        line = LineString(points)
        if line.is_empty:
            continue
        center_lat = line.centroid.y
        lat_padding = corridor_km / EARTH_KM_PER_DEGREE
        lon_padding = min(2.0, lat_padding / max(0.05, math.cos(math.radians(center_lat))))
        envelope = box(line.bounds[0] - lon_padding, line.bounds[1] - lat_padding, line.bounds[2] + lon_padding, line.bounds[3] + lat_padding)
        project = projector(center_lat)
        metric_line = transform(project, line)
        for candidate in tree.query(envelope):
            border = borders[int(candidate)]
            if metric_line.distance(transform(project, border)) <= corridor_km:
                return True
    return False


def bounds_for_parts(parts: list[list[list[float]]]) -> list[float]:
    points = [point for part in parts for point in part]
    return [
        min(point[0] for point in points), min(point[1] for point in points),
        max(point[0] for point in points), max(point[1] for point in points),
    ]


def stable_source_geometry_id(source_ids: set[str], parts: list[list[list[float]]]) -> str:
    digest = hashlib.sha256()
    for source_id in sorted(source_ids, key=lambda value: (0, int(value)) if value.isdigit() else (1, value)):
        digest.update(source_id.encode("utf-8"))
        digest.update(b"\0")
    for part in parts:
        digest.update(b"\x1e")
        for longitude, latitude in part:
            digest.update(f"{longitude:.6f},{latitude:.6f};".encode("ascii"))
    return f"source-{digest.hexdigest()[:20]}"


def build(source: Path, countries_path: Path, output: Path, corridor_km: float) -> None:
    raw = decode_raw_rivers(source)
    borders = shared_country_borders(countries_path)
    border_tree = STRtree(borders)
    features = []
    selected_coordinate_count = 0
    for logical_id, row in sorted(raw.items()):
        if not river_near_shared_border(row["parts"], borders, border_tree, corridor_km):
            continue
        geometry = {
            "type": "LineString" if len(row["parts"]) == 1 else "MultiLineString",
            "coordinates": row["parts"][0] if len(row["parts"]) == 1 else row["parts"],
        }
        feature_id = stable_source_geometry_id(row["sourceIds"], row["parts"])
        selected_coordinate_count += sum(len(part) for part in row["parts"])
        features.append({
            "type": "Feature",
            "id": feature_id,
            "properties": {
                "category": "river",
                "pandolab_id": feature_id,
                "source_logical_id": str(logical_id),
                "source_id": ",".join(sorted(row["sourceIds"], key=lambda value: (0, int(value)) if value.isdigit() else (1, value))),
                "name": row["name"],
            },
            "geometry": geometry,
            "bounds": bounds_for_parts(row["parts"]),
        })
    payload = json.dumps({
        "version": 1,
        "cellSizeDegrees": 1,
        "features": features,
    }, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    compressed = gzip.compress(payload, compresslevel=9, mtime=0)
    output.mkdir(parents=True, exist_ok=True)
    data_path = output / "source.json.gz"
    data_path.write_bytes(compressed)
    manifest = {
        "version": "annex-source-v1",
        "schema": "pandolab-river-annex-source-v1",
        "crs": "EPSG:4326",
        "source": "assets/data/hydro/v0.12.3 raw HydroRIVERS vertices",
        "buildCorridorM": round(corridor_km * 1000),
        "featureCount": len(features),
        "coordinateCount": selected_coordinate_count,
        "data": {
            "url": "source.json.gz",
            "bytes": len(compressed),
            "sha256": hashlib.sha256(compressed).hexdigest(),
        },
    }
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"river annex source: {len(features):,} logical rivers, {len(compressed) / 1024 / 1024:.2f} MiB")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=ROOT / "assets/data/hydro/v0.12.3")
    parser.add_argument("--countries", type=Path, default=ROOT / "assets/data/countries-ne-5.1.1.geojson")
    parser.add_argument("--output", type=Path, default=ROOT / "assets/data/hydro/annex-source-v1")
    parser.add_argument("--corridor-km", type=float, default=10.0)
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    build(args.source.resolve(), args.countries.resolve(), args.output.resolve(), args.corridor_km)
