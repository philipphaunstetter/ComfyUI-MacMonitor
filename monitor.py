"""StatsCollector — pulls live system metrics for ComfyUI on Apple Silicon."""

from __future__ import annotations

import logging
import platform
import threading
import time
from typing import Any

import psutil

# Process names whose memory we surface separately. Ollama runs as its own
# daemon, so its MPS allocations are invisible to torch.mps.* — but we can
# read its RSS from psutil and show it as unified-memory pressure on the bar.
EXTERNAL_PROC_TARGETS: set[str] = {
    "ollama",
    "ollama-runner",
    "ollama_llama_server",
}

log = logging.getLogger("ComfyUI-MacMonitor")

try:
    import torch
    _torch_available = True
except ImportError:
    torch = None  # type: ignore
    _torch_available = False


def _mps_available() -> bool:
    if not _torch_available:
        return False
    try:
        return bool(torch.backends.mps.is_available())  # type: ignore[union-attr]
    except Exception:
        return False


class StatsCollector:
    """Single-instance metrics collector. Holds light state for gen-time + sampling."""

    def __init__(self) -> None:
        self.last_gen_seconds: float | None = None
        self.is_generating: bool = False
        self._chip = self._detect_chip()
        # Per-node timings for the most recent run. Mutated by execution_hooks.
        self._node_lock = threading.Lock()
        self._current_node_times: dict[str, float] = {}
        self._current_node_starts: dict[str, float] = {}
        self.last_run_node_times: list[dict[str, Any]] = []  # [{id, seconds}]
        # Prime psutil — first call without interval returns 0.0.
        psutil.cpu_percent(interval=None)
        psutil.cpu_percent(interval=None, percpu=True)
        # External-proc scan is comparatively expensive; cache for ~2s.
        self._ext_cache: dict[str, Any] = {"ts": 0.0, "value": {"total_bytes": 0, "processes": []}}
        self._mps_ok = _mps_available()
        if not self._mps_ok:
            log.info("MacMonitor: MPS not available — VRAM fields will be null.")

    @staticmethod
    def _detect_chip() -> str:
        try:
            mach = platform.machine()
            if mach == "arm64":
                return "Apple Silicon"
            return mach or "unknown"
        except Exception:
            return "unknown"

    def mark_gen_start(self) -> None:
        self.is_generating = True
        with self._node_lock:
            self._current_node_times.clear()
            self._current_node_starts.clear()

    def mark_gen_end(self, seconds: float) -> None:
        self.is_generating = False
        self.last_gen_seconds = round(seconds, 3)
        with self._node_lock:
            sorted_nodes = sorted(
                self._current_node_times.items(), key=lambda kv: kv[1], reverse=True
            )
            self.last_run_node_times = [
                {"id": nid, "seconds": round(s, 3)} for nid, s in sorted_nodes
            ]

    def mark_node_start(self, node_id: str) -> None:
        with self._node_lock:
            self._current_node_starts[node_id] = time.perf_counter()

    def mark_node_end(self, node_id: str) -> None:
        with self._node_lock:
            t0 = self._current_node_starts.pop(node_id, None)
        if t0 is None:
            return
        dt = time.perf_counter() - t0
        with self._node_lock:
            self._current_node_times[node_id] = self._current_node_times.get(node_id, 0.0) + dt

    def _external_proc_memory(self) -> dict[str, Any]:
        now = time.time()
        if now - self._ext_cache["ts"] < 2.0:
            return self._ext_cache["value"]
        total = 0
        procs: list[dict[str, Any]] = []
        for p in psutil.process_iter(["name", "memory_info"]):
            try:
                name = (p.info.get("name") or "").lower()
                if name in EXTERNAL_PROC_TARGETS:
                    rss = int(p.info["memory_info"].rss)
                    total += rss
                    procs.append({"name": p.info["name"], "rss_bytes": rss})
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue
        value = {"total_bytes": total, "processes": procs}
        self._ext_cache = {"ts": now, "value": value}
        return value

    def snapshot(self) -> dict[str, Any]:
        errors: list[str] = []
        ts = time.time()

        try:
            cpu_percent = psutil.cpu_percent(interval=None)
            cpu_per_core = psutil.cpu_percent(interval=None, percpu=True)
        except Exception as e:
            errors.append(f"cpu: {e}")
            cpu_percent = None
            cpu_per_core = []

        try:
            vm = psutil.virtual_memory()
            ram_used = int(vm.total - vm.available)
            ram_total = int(vm.total)
        except Exception as e:
            errors.append(f"ram: {e}")
            ram_used = None
            ram_total = None

        vram_allocated: int | None = None
        vram_driver: int | None = None
        if self._mps_ok:
            try:
                vram_allocated = int(torch.mps.current_allocated_memory())  # type: ignore[union-attr]
            except Exception as e:
                errors.append(f"vram_alloc: {e}")
            try:
                vram_driver = int(torch.mps.driver_allocated_memory())  # type: ignore[union-attr]
            except Exception as e:
                errors.append(f"vram_driver: {e}")

        try:
            ext = self._external_proc_memory()
        except Exception as e:
            errors.append(f"ext_procs: {e}")
            ext = {"total_bytes": 0, "processes": []}

        out: dict[str, Any] = {
            "ts": ts,
            "chip": self._chip,
            "cpu_percent": cpu_percent,
            "cpu_per_core": cpu_per_core,
            "ram_used_bytes": ram_used,
            "ram_total_bytes": ram_total,
            "vram_allocated_bytes": vram_allocated,
            "vram_driver_bytes": vram_driver,
            "gpu_percent": None,
            "last_gen_seconds": self.last_gen_seconds,
            "is_generating": self.is_generating,
            "external_memory_bytes": ext["total_bytes"],
            "external_processes": ext["processes"],
            "last_run_node_times": self.last_run_node_times,
        }
        if errors:
            out["errors"] = errors
        return out


collector = StatsCollector()
