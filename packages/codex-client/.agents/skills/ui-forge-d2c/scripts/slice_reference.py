#!/usr/bin/env python3
"""Create deterministic, traceable region slices from one canonical reference image."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any


NAME = "ui-forge-reference-slicer"
VERSION = "1.0.0"
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Crop region slices and emit a provenance index."
    )
    parser.add_argument("--version", action="version", version=f"{NAME} {VERSION}")
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--index", type=Path, required=True)
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fail(message: str) -> int:
    print(
        json.dumps(
            {
                "slicer": {"name": NAME, "version": VERSION},
                "ok": False,
                "error": message,
            },
            ensure_ascii=False,
            sort_keys=True,
            indent=2,
        )
    )
    return 2


def integer_field(region: dict[str, Any], field: str) -> int:
    value = region.get(field)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"region {region.get('id', '<unknown>')} has invalid {field}")
    return value


def main() -> int:
    args = parse_args()
    try:
        from PIL import Image
    except ImportError:
        return fail("Pillow is required; install it with `python3 -m pip install Pillow`.")

    reference_path = args.reference.expanduser().resolve()
    manifest_path = args.manifest.expanduser().resolve()
    output_dir = args.output_dir.expanduser().resolve()
    index_path = args.index.expanduser().resolve()

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        regions = manifest["regions"]
        if not isinstance(regions, list) or not regions:
            raise ValueError("manifest.regions must be a non-empty array")
        with Image.open(reference_path) as source:
            reference = source.convert("RGBA")
    except (FileNotFoundError, OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        return fail(str(exc))

    seen_ids: set[str] = set()
    normalized: list[dict[str, Any]] = []
    try:
        for raw in regions:
            if not isinstance(raw, dict):
                raise ValueError("every region must be an object")
            region_id = raw.get("id")
            if not isinstance(region_id, str) or not SAFE_ID.fullmatch(region_id):
                raise ValueError(f"invalid region id: {region_id!r}")
            if region_id in seen_ids:
                raise ValueError(f"duplicate region id: {region_id}")
            seen_ids.add(region_id)
            x = integer_field(raw, "x")
            y = integer_field(raw, "y")
            width = integer_field(raw, "width")
            height = integer_field(raw, "height")
            if x < 0 or y < 0 or width <= 0 or height <= 0:
                raise ValueError(f"region {region_id} has non-positive or negative bounds")
            if x + width > reference.width or y + height > reference.height:
                raise ValueError(f"region {region_id} exceeds the canonical reference")
            normalized.append(
                {
                    "id": region_id,
                    "x": x,
                    "y": y,
                    "width": width,
                    "height": height,
                    "parentId": raw.get("parentId"),
                    "adjacentIds": raw.get("adjacentIds", []),
                    "interactionRefs": raw.get("interactionRefs", []),
                }
            )
    except ValueError as exc:
        return fail(str(exc))

    output_dir.mkdir(parents=True, exist_ok=True)
    slices: list[dict[str, Any]] = []
    for region in sorted(normalized, key=lambda item: item["id"]):
        output_path = output_dir / f"{region['id']}.png"
        crop = reference.crop(
            (
                region["x"],
                region["y"],
                region["x"] + region["width"],
                region["y"] + region["height"],
            )
        )
        crop.save(output_path, format="PNG", compress_level=9, optimize=False)
        slices.append(
            {
                **region,
                "path": str(output_path),
                "sha256": sha256_file(output_path),
                "coordinateTransform": {
                    "sliceToReference": {"translateX": region["x"], "translateY": region["y"]}
                },
            }
        )

    payload = {
        "slicer": {"name": NAME, "version": VERSION},
        "ok": True,
        "reference": {
            "path": str(reference_path),
            "sha256": sha256_file(reference_path),
            "width": reference.width,
            "height": reference.height,
        },
        "manifest": {"path": str(manifest_path), "sha256": sha256_file(manifest_path)},
        "slices": slices,
    }
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
