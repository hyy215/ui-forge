#!/usr/bin/env python3
"""Deterministically compare two screenshots for the UI Forge D2C workflow."""

from __future__ import annotations

import argparse
from collections import deque
import hashlib
from io import BytesIO
import json
from pathlib import Path
import sys
from typing import Any


NAME = "ui-forge-pixel-compare"
VERSION = "1.1.1"


class ComparisonArgumentParser(argparse.ArgumentParser):
    """Keep invalid invocations on the same JSON error channel as runtime failures."""

    def error(self, message: str) -> None:
        raise ValueError(message)


def parse_args() -> argparse.Namespace:
    parser = ComparisonArgumentParser(
        description="Compare two images with per-channel tolerance and 8-neighbor regions."
    )
    parser.add_argument("--version", action="version", version=f"{NAME} {VERSION}")
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--actual", type=Path, required=True)
    parser.add_argument("--diff", type=Path, required=True)
    parser.add_argument("--channel-tolerance", type=int, required=True)
    parser.add_argument("--max-different-pixel-ratio", type=float, required=True)
    parser.add_argument("--max-connected-region-ratio", type=float, required=True)
    parser.add_argument("--max-reported-regions", type=int, default=50)
    return parser.parse_args()


def paths_alias(first: Path, second: Path) -> bool:
    """Compare resolved names and existing file identities, including hard links."""
    if str(first).casefold() == str(second).casefold():
        return True
    try:
        return first.samefile(second)
    except (FileNotFoundError, NotADirectoryError):
        return False


def emit(payload: dict[str, Any], exit_code: int) -> int:
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2))
    return exit_code


def error_payload(kind: str, message: str) -> dict[str, Any]:
    return {
        "comparator": {"name": NAME, "version": VERSION},
        "pass": False,
        "error": {"kind": kind, "message": message},
    }


def connected_regions(mask: Any, width: int, height: int) -> list[dict[str, Any]]:
    pixels = mask.load()
    visited = bytearray(width * height)
    regions: list[dict[str, Any]] = []

    for y in range(height):
        row_offset = y * width
        for x in range(width):
            index = row_offset + x
            if visited[index] or pixels[x, y] == 0:
                continue

            visited[index] = 1
            pending: deque[int] = deque([index])
            area = 0
            min_x = max_x = x
            min_y = max_y = y

            while pending:
                current = pending.popleft()
                current_y, current_x = divmod(current, width)
                area += 1
                min_x = min(min_x, current_x)
                max_x = max(max_x, current_x)
                min_y = min(min_y, current_y)
                max_y = max(max_y, current_y)

                start_y = max(0, current_y - 1)
                end_y = min(height - 1, current_y + 1)
                start_x = max(0, current_x - 1)
                end_x = min(width - 1, current_x + 1)
                for neighbor_y in range(start_y, end_y + 1):
                    neighbor_offset = neighbor_y * width
                    for neighbor_x in range(start_x, end_x + 1):
                        neighbor = neighbor_offset + neighbor_x
                        if visited[neighbor] or pixels[neighbor_x, neighbor_y] == 0:
                            continue
                        visited[neighbor] = 1
                        pending.append(neighbor)

            fingerprint_input = f"{min_x}:{min_y}:{max_x}:{max_y}:{area}".encode()
            regions.append(
                {
                    "area": area,
                    "bounds": {
                        "x": min_x,
                        "y": min_y,
                        "width": max_x - min_x + 1,
                        "height": max_y - min_y + 1,
                    },
                    "fingerprint": hashlib.sha256(fingerprint_input).hexdigest()[:16],
                }
            )

    regions.sort(key=lambda region: (-region["area"], region["bounds"]["y"], region["bounds"]["x"]))
    return regions


def main() -> int:
    try:
        args = parse_args()
    except ValueError as exc:
        return emit(error_payload("invalid_argument", str(exc)), 2)

    if not 0 <= args.channel_tolerance <= 255:
        return emit(error_payload("invalid_argument", "channel tolerance must be between 0 and 255"), 2)
    if not 0 <= args.max_different_pixel_ratio <= 1:
        return emit(error_payload("invalid_argument", "different-pixel ratio must be between 0 and 1"), 2)
    if not 0 <= args.max_connected_region_ratio <= 1:
        return emit(error_payload("invalid_argument", "connected-region ratio must be between 0 and 1"), 2)
    if args.max_reported_regions < 0:
        return emit(error_payload("invalid_argument", "max reported regions cannot be negative"), 2)

    try:
        from PIL import Image, ImageChops, ImageOps
    except ImportError:
        return emit(
            error_payload(
                "missing_dependency",
                "Pillow is required; check the environment or request approval before installing it.",
            ),
            2,
        )

    try:
        reference_path = args.reference.expanduser().resolve()
        actual_path = args.actual.expanduser().resolve()
        diff_path = args.diff.expanduser().resolve()
        if any(paths_alias(diff_path, path) for path in (reference_path, actual_path)):
            return emit(error_payload("output_collision", "diff output must not overwrite an input image"), 2)
    except (OSError, RuntimeError, ValueError) as exc:
        return emit(error_payload("path_check_failed", str(exc)), 2)

    try:
        reference_bytes = reference_path.read_bytes()
        actual_bytes = actual_path.read_bytes()
        with Image.open(BytesIO(reference_bytes)) as source:
            reference = source.convert("RGBA")
        with Image.open(BytesIO(actual_bytes)) as source:
            actual = source.convert("RGBA")
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        return emit(error_payload("image_read_failed", str(exc)), 2)

    base_payload: dict[str, Any] = {
        "comparator": {"name": NAME, "version": VERSION},
        "artifacts": {
            "reference": {"path": str(reference_path), "sha256": hashlib.sha256(reference_bytes).hexdigest()},
            "actual": {"path": str(actual_path), "sha256": hashlib.sha256(actual_bytes).hexdigest()},
            "diff": {"path": str(diff_path)},
        },
        "channelTolerance": args.channel_tolerance,
        "thresholds": {
            "maxDifferentPixelRatio": args.max_different_pixel_ratio,
            "maxConnectedRegionRatio": args.max_connected_region_ratio,
        },
    }

    if reference.size != actual.size:
        base_payload.update(
            {
                "pass": False,
                "dimensionsMatch": False,
                "referenceSize": {"width": reference.width, "height": reference.height},
                "actualSize": {"width": actual.width, "height": actual.height},
                "failureReasons": ["dimension_mismatch"],
            }
        )
        return emit(base_payload, 1)

    width, height = reference.size
    total_pixels = width * height
    channel_differences = ImageChops.difference(reference, actual).split()
    masks = [
        channel.point(lambda value: 255 if value > args.channel_tolerance else 0)
        for channel in channel_differences
    ]
    difference_mask = masks[0]
    for mask in masks[1:]:
        difference_mask = ImageChops.lighter(difference_mask, mask)

    different_pixels = difference_mask.histogram()[255]
    different_ratio = different_pixels / total_pixels if total_pixels else 0.0
    regions = connected_regions(difference_mask, width, height)
    largest_region_area = regions[0]["area"] if regions else 0
    largest_region_ratio = largest_region_area / total_pixels if total_pixels else 0.0

    grayscale = ImageOps.grayscale(actual.convert("RGB")).convert("RGBA")
    grayscale.putalpha(96)
    highlight = Image.new("RGBA", actual.size, (255, 0, 128, 255))
    diff_image = Image.composite(highlight, grayscale, difference_mask)
    try:
        encoded = BytesIO()
        diff_image.save(encoded, format="PNG", compress_level=9, optimize=False)
        diff_bytes = encoded.getvalue()
        diff_path.parent.mkdir(parents=True, exist_ok=True)
        diff_path.write_bytes(diff_bytes)
    except (OSError, ValueError) as exc:
        return emit(error_payload("diff_write_failed", str(exc)), 2)

    failure_reasons: list[str] = []
    if different_ratio > args.max_different_pixel_ratio:
        failure_reasons.append("different_pixel_ratio_exceeded")
    if largest_region_ratio > args.max_connected_region_ratio:
        failure_reasons.append("connected_region_ratio_exceeded")
    passed = not failure_reasons

    reported_regions: list[dict[str, Any]] = []
    for region in regions[: args.max_reported_regions]:
        reported = dict(region)
        reported["ratio"] = region["area"] / total_pixels if total_pixels else 0.0
        reported_regions.append(reported)

    base_payload["artifacts"]["diff"]["sha256"] = hashlib.sha256(diff_bytes).hexdigest()
    base_payload.update(
        {
            "pass": passed,
            "dimensionsMatch": True,
            "size": {"width": width, "height": height},
            "totalPixels": total_pixels,
            "differentPixels": different_pixels,
            "differentPixelRatio": different_ratio,
            "connectedComponents": {
                "count": len(regions),
                "largestArea": largest_region_area,
                "largestRatio": largest_region_ratio,
                "reportedCount": len(reported_regions),
                "regions": reported_regions,
            },
            "failureReasons": failure_reasons,
        }
    )
    return emit(base_payload, 0 if passed else 1)


if __name__ == "__main__":
    sys.exit(main())
