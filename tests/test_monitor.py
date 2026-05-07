"""Smoke tests — verify snapshot shape without ComfyUI running."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import importlib

mod = importlib.import_module(Path(__file__).resolve().parent.parent.name + ".monitor")


REQUIRED_KEYS = {
    "ts",
    "chip",
    "cpu_percent",
    "cpu_per_core",
    "ram_used_bytes",
    "ram_total_bytes",
    "vram_allocated_bytes",
    "vram_driver_bytes",
    "gpu_percent",
    "last_gen_seconds",
    "is_generating",
}


def test_snapshot_shape():
    s = mod.collector.snapshot()
    missing = REQUIRED_KEYS - set(s.keys())
    assert not missing, f"missing keys: {missing}"


def test_snapshot_ram_sane():
    s = mod.collector.snapshot()
    assert s["ram_total_bytes"] is None or s["ram_total_bytes"] > 0
    if s["ram_used_bytes"] is not None and s["ram_total_bytes"]:
        assert 0 <= s["ram_used_bytes"] <= s["ram_total_bytes"]


def test_mark_gen_records_seconds():
    mod.collector.mark_gen_start()
    assert mod.collector.is_generating is True
    mod.collector.mark_gen_end(1.234)
    assert mod.collector.is_generating is False
    assert mod.collector.last_gen_seconds == 1.234
