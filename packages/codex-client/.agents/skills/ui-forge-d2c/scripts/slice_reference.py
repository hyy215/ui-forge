#!/usr/bin/env python3
"""Create deterministic, traceable region slices from one canonical reference image."""

from __future__ import annotations

import argparse
import hashlib
from io import BytesIO
import json
from pathlib import Path
import re
import sys
from typing import Any


NAME = "ui-forge-reference-slicer"
VERSION = "1.0.1"
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


class SlicerArgumentParser(argparse.ArgumentParser):
    """Report invalid CLI input through the slicer's structured failure result."""

    def error(self, message: str) -> None:
        raise ValueError(message)


def parse_args() -> argparse.Namespace:
    parser = SlicerArgumentParser(
        description="Crop region slices and emit a provenance index."
    )
    parser.add_argument("--version", action="version", version=f"{NAME} {VERSION}")
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--index", type=Path, required=True)
    return parser.parse_args()


def paths_alias(first: Path, second: Path) -> bool:
    """Compare resolved names and existing file identities, including hard links."""
    if str(first).casefold() == str(second).casefold():
        return True
    try:
        return first.samefile(second)
    except (FileNotFoundError, NotADirectoryError):
        return False


def validate_outputs(inputs: list[Path], outputs: list[Path]) -> None:
    """Check the complete output plan before creating directories or writing files."""
    for index, output in enumerate(outputs):
        for protected in inputs + outputs[:index]:
            shared_parent = (
                str(output).casefold() in {str(parent).casefold() for parent in protected.parents}
                or str(protected).casefold() in {str(parent).casefold() for parent in output.parents}
            )
            if paths_alias(output, protected) or shared_parent:
                raise ValueError("output paths must not collide with inputs or other outputs")
        if output.exists() and not output.is_file():
            raise ValueError("output path must be a file")
        if any(parent.exists() and not parent.is_dir() for parent in output.parents):
            raise ValueError("output parent must be a directory")


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
    try:
        args = parse_args()
    except ValueError as exc:
        return fail(str(exc))
    try:
        from PIL import Image
    except ImportError:
        return fail("Pillow is required; check the environment or request approval before installing it.")

    try:
        reference_path = args.reference.expanduser().resolve()
        manifest_path = args.manifest.expanduser().resolve()
        output_dir = args.output_dir.expanduser().resolve()
        index_path = args.index.expanduser().resolve()
        manifest_bytes = manifest_path.read_bytes()
        reference_bytes = reference_path.read_bytes()
        manifest = json.loads(manifest_bytes.decode("utf-8"))
        regions = manifest["regions"]
        if not isinstance(regions, list) or not regions:
            raise ValueError("manifest.regions must be a non-empty array")
        with Image.open(BytesIO(reference_bytes)) as source:
            reference = source.convert("RGBA")
    except (OSError, RuntimeError, KeyError, TypeError, ValueError, Image.DecompressionBombError) as exc:
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
            if region_id.casefold() in seen_ids:
                raise ValueError(f"duplicate region id: {region_id}")
            seen_ids.add(region_id.casefold())
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

    ordered_regions = sorted(normalized, key=lambda item: item["id"])
    try:
        output_paths = [(output_dir / f"{region['id']}.png").resolve() for region in ordered_regions]
        validate_outputs([reference_path, manifest_path], [*output_paths, index_path])
    except (OSError, RuntimeError, ValueError) as exc:
        return fail(str(exc))

    slices: list[dict[str, Any]] = []
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
        for region, output_path in zip(ordered_regions, output_paths):
            crop = reference.crop(
                (
                    region["x"],
                    region["y"],
                    region["x"] + region["width"],
                    region["y"] + region["height"],
                )
            )
            encoded = BytesIO()
            crop.save(encoded, format="PNG", compress_level=9, optimize=False)
            crop_bytes = encoded.getvalue()
            output_path.write_bytes(crop_bytes)
            slices.append(
                {
                    **region,
                    "path": str(output_path),
                    "sha256": hashlib.sha256(crop_bytes).hexdigest(),
                    "coordinateTransform": {
                        "sliceToReference": {"translateX": region["x"], "translateY": region["y"]}
                    },
                }
            )
    except (OSError, ValueError) as exc:
        return fail(str(exc))

    payload = {
        "slicer": {"name": NAME, "version": VERSION},
        "ok": True,
        "reference": {
            "path": str(reference_path),
            "sha256": hashlib.sha256(reference_bytes).hexdigest(),
            "width": reference.width,
            "height": reference.height,
        },
        "manifest": {"path": str(manifest_path), "sha256": hashlib.sha256(manifest_bytes).hexdigest()},
        "slices": slices,
    }
    try:
        index_path.parent.mkdir(parents=True, exist_ok=True)
        index_path.write_text(
            json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )
    except (OSError, ValueError) as exc:
        return fail(str(exc))
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
