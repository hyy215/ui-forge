#!/usr/bin/env python3
"""Deterministically compare two screenshots for the UI Forge D2C workflow."""

from __future__ import annotations

import argparse
from collections import deque
import hashlib
import json
from pathlib import Path
import sys
from typing import Any


NAME = "ui-forge-pixel-compare"
VERSION = "1.1.0"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
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


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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
    args = parse_args()

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
                "Pillow is required; install it with `python3 -m pip install Pillow`.",
            ),
            2,
        )

    reference_path = args.reference.expanduser().resolve()
    actual_path = args.actual.expanduser().resolve()
    diff_path = args.diff.expanduser().resolve()

    try:
        with Image.open(reference_path) as source:
            reference = source.convert("RGBA")
        with Image.open(actual_path) as source:
            actual = source.convert("RGBA")
    except (FileNotFoundError, OSError) as exc:
        return emit(error_payload("image_read_failed", str(exc)), 2)

    base_payload: dict[str, Any] = {
        "comparator": {"name": NAME, "version": VERSION},
        "artifacts": {
            "reference": {"path": str(reference_path), "sha256": sha256_file(reference_path)},
            "actual": {"path": str(actual_path), "sha256": sha256_file(actual_path)},
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
        diff_path.parent.mkdir(parents=True, exist_ok=True)
        diff_image.save(diff_path, format="PNG", compress_level=9, optimize=False)
    except OSError as exc:
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

    base_payload["artifacts"]["diff"]["sha256"] = sha256_file(diff_path)
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
