# ComfyUI-MacMonitor — PRD & Build Plan

A live system performance monitor for ComfyUI on Apple Silicon (MPS backend). Fills the gap left by Crystools, which is NVIDIA-only.

---

## 1. Problem

ComfyUI on macOS has no integrated performance monitor. Crystools, the de facto solution on Windows/Linux, depends on `pynvml` and silently fails or shows blanks on Apple Silicon. Mac users currently run `asitop` or `mactop` in a side terminal, which works but breaks flow and doesn't surface ComfyUI-specific data like MPS VRAM allocation per workflow.

## 2. Goals

- Show GPU%, VRAM, CPU%, RAM, and per-workflow generation time in a live bar inside the ComfyUI UI.
- Work on Apple Silicon (M1/M2/M3/M4) without requiring `sudo` for the MVP.
- Install via ComfyUI Manager with one click — no native compilation, no system daemon.
- Update at ~1 Hz with negligible CPU overhead (<1% on an M-series chip).
- **Run ambiently as a UI extension. No workflow node, no input/output sockets, no graph wiring.** The user installs it, restarts ComfyUI, and the bar appears. Nothing to drag onto the canvas.

## 3. Non-goals

- Intel Mac support beyond best-effort (no Apple Silicon GPU APIs apply).
- Cross-platform parity with Crystools — this is Mac-only.
- Historical logging, alerting, or export. Live monitoring only for v1.
- Per-process GPU breakdown. macOS doesn't expose this cleanly.

## 4. Target user

ComfyUI users on Apple Silicon running local image/video generation who want to see resource pressure without leaving the canvas. Power users who load large models (Flux, SDXL, video) and need to know when they're about to OOM.

## 5. Success metrics

- 500+ installs in first 60 days via ComfyUI Manager.
- <50ms added latency per UI poll cycle.
- Zero-config install: works immediately after restart, no settings required.
- Issue rate <5% of installs (tracked via GitHub issues).

---

## 6. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  ComfyUI Frontend (Vue + LiteGraph)                     │
│  ┌──────────────────────────────────────────────────┐   │
│  │  monitor.js  ── injects status bar               │   │
│  │              ── polls /macmonitor/stats @ 1Hz    │   │
│  │              ── renders sparklines + values      │   │
│  └────────────────────┬─────────────────────────────┘   │
└───────────────────────┼─────────────────────────────────┘
                        │ HTTP GET
                        ▼
┌─────────────────────────────────────────────────────────┐
│  ComfyUI Python Backend (aiohttp)                       │
│  ┌──────────────────────────────────────────────────┐   │
│  │  __init__.py  ── registers route + node          │   │
│  │  monitor.py   ── StatsCollector                  │   │
│  │                  ├─ psutil   (CPU, RAM, disk)    │   │
│  │                  ├─ torch.mps  (VRAM)            │   │
│  │                  └─ IOReport  (GPU%, optional)   │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Data sources

| Metric | Source | sudo? | Notes |
|---|---|---|---|
| CPU % (overall + per-core) | `psutil.cpu_percent` | No | Cross-platform, reliable |
| RAM used / total | `psutil.virtual_memory` | No | Includes swap pressure |
| Disk I/O | `psutil.disk_io_counters` | No | Optional in v1 |
| MPS VRAM (allocated) | `torch.mps.current_allocated_memory()` | No | What ComfyUI is actually using |
| MPS VRAM (driver) | `torch.mps.driver_allocated_memory()` | No | Total reserved by MPS |
| Unified memory total | `psutil.virtual_memory().total` | No | Apple Silicon has unified memory |
| GPU utilization % | IOReport via `ctypes`/`pyobjc` | No | Stretch — requires private framework |
| GPU power (W) | `powermetrics` | Yes | Stretch — out of scope for v1 |
| Generation time | ComfyUI execution hooks | No | Wrap `PromptExecutor` |

---

## 7. Scope

### MVP (v0.1) — ship in 1 week

- Status bar at top of UI showing: CPU %, RAM used/total, MPS VRAM allocated, generation time of last run.
- 1 Hz polling.
- Settings panel: enable/disable, choose poll interval (0.5s / 1s / 2s).
- ComfyUI Manager registration.

### v0.2 — ship in 2 weeks

- GPU utilization % via IOReport (private framework, no sudo).
- Sparkline graphs for each metric (last 60 seconds).
- Per-node generation timings (which node is slowest).
- Color-coded warnings when VRAM > 80% or RAM > 90%.

### v0.3 — stretch

- Optional power/temperature via `powermetrics` (requires sudoers config; document, don't auto-install).
- Export session stats as JSON.
- Compact mode / customizable bar layout.

### Out of scope

- Windows/Linux support.
- NVIDIA GPU support.
- Cloud/remote ComfyUI monitoring.
- Replacing existing logging tools.
- **A workflow node with input/output sockets.** This plugin is a UI-only extension. Users do not place a "MacMonitor" node onto the canvas. There are no NODE_CLASS_MAPPINGS entries that show up in the node menu. The bar just exists, like a toolbar.

---

## 8. UX

### Status bar

A thin horizontal bar pinned to the top of the ComfyUI canvas, dismissible via a chevron toggle. Shows:

```
 CPU 34%  │  RAM 18.2 / 64 GB  │  VRAM 11.4 GB  │  ⏱ 4.2s
```

Each cell is clickable — click to expand into a popover with a 60-second sparkline.

### Settings

Lives under ComfyUI Settings → Extensions → MacMonitor:
- Enable monitor (toggle)
- Poll interval (0.5s / 1s / 2s)
- Show sparklines (toggle)
- Position (top / bottom)
- Compact mode (toggle)

### States

- **Idle** — neutral colors, all metrics in normal range
- **Warning** — yellow when VRAM > 80% or RAM > 90%
- **Critical** — red when VRAM > 95% (likely OOM imminent)

---

## 9. File structure

```
ComfyUI-MacMonitor/
├── __init__.py             # route mounting + WEB_DIRECTORY export (no nodes)
├── monitor.py              # StatsCollector class
├── server.py               # aiohttp route handlers
├── execution_hooks.py      # taps into ComfyUI's PromptExecutor
├── pyproject.toml          # PEP 621 metadata for ComfyUI Manager
├── README.md
├── LICENSE
└── web/
    ├── monitor.js          # frontend extension
    ├── monitor.css
    └── sparkline.js
```

`__init__.py` exports an **empty** `NODE_CLASS_MAPPINGS = {}` and `NODE_DISPLAY_NAME_MAPPINGS = {}` — required by ComfyUI's loader, but intentionally empty. The actual surface is `WEB_DIRECTORY = "./web"` plus a registered HTTP route. Nothing appears in the node search menu.

### Backend API

Single endpoint, single shape:

```
GET /macmonitor/stats

200 OK
{
  "ts": 1714940000.123,
  "cpu_percent": 34.2,
  "cpu_per_core": [22, 41, 18, ...],
  "ram_used_bytes": 19541230080,
  "ram_total_bytes": 68719476736,
  "vram_allocated_bytes": 12230590464,
  "vram_driver_bytes": 13510000000,
  "gpu_percent": 78.4,            // null if IOReport unavailable
  "last_gen_seconds": 4.21,       // null if no run yet
  "is_generating": false
}
```

### Frontend hook

```js
app.registerExtension({
  name: "MacMonitor",
  async setup() {
    // inject bar into DOM
    // start polling /macmonitor/stats
  },
});
```

---

## 10. Technical risks

| Risk | Severity | Mitigation |
|---|---|---|
| `torch.mps.current_allocated_memory()` reports lower than actual usage | Medium | Also expose `driver_allocated_memory()`; document the difference |
| IOReport private framework changes between macOS versions | Medium | Wrap in try/except; gracefully degrade to "GPU% unavailable" |
| ComfyUI frontend API changes (Vue migration ongoing) | High | Pin to current frontend version; subscribe to ComfyUI release notes |
| Polling overhead during generation slows runs | Low | Pause polling during execution, or reduce to 0.5 Hz |
| `psutil` Apple Silicon edge cases (per-core on P/E clusters) | Low | Test on M1/M2/M3; report cluster-aware if available |

---

## 11. Implementation plan

### Week 1 — MVP

**Day 1–2: backend skeleton**
- `__init__.py` with NODE_CLASS_MAPPINGS + route registration
- `monitor.py` with `StatsCollector.snapshot()` returning the JSON shape above
- Verify `/macmonitor/stats` returns valid data via curl

**Day 3–4: frontend bar**
- `monitor.js` with `app.registerExtension`, DOM injection, fetch loop
- Basic CSS for the bar
- Test in real ComfyUI session

**Day 5: execution hooks**
- Monkey-patch or hook into ComfyUI's `PromptExecutor` to capture generation time
- Wire to backend state

**Day 6: settings panel**
- Hook into ComfyUI settings registry
- Persist poll interval + enabled state

**Day 7: polish + Manager registration**
- `pyproject.toml` with proper metadata
- README with screenshots
- Submit to ComfyUI Manager registry

### Week 2 — v0.2

- IOReport binding (study `asitop` source — `iorep.py`)
- Sparklines (lightweight, no chart library — raw canvas)
- Per-node timings via execution hook expansion
- Warning thresholds

### Week 3 — release & iterate

- Beta release on GitHub
- Collect feedback
- Bug bash on M1/M2/M3 hardware
- Public announcement (ComfyUI Discord, r/comfyui, X)

---

## 12. Dependencies

**Required:**
- `psutil >= 5.9` — already in most ComfyUI installs
- `torch >= 2.0` — comes with ComfyUI

**Optional:**
- `pyobjc-framework-Cocoa` — only if pursuing IOReport

No native compilation. No system-level installs. Pure Python + JS.

---

## 13. Open questions

1. Should we hook into the PromptExecutor via monkey-patch or via ComfyUI's existing event hooks (if any exist for "execution_start" / "execution_end")? Need to read ComfyUI source.
2. Is there a clean way to detect M1 vs M2 vs M3 chip class from Python without `sysctl` shell-out? Affects display label.
3. Frontend: stick with vanilla JS or use the same Vue stack ComfyUI is migrating to? Vanilla is more stable across ComfyUI versions.

**Decided:** This is a UI-only extension. No workflow node with sockets. No graph integration. Just an ambient bar.

---

## 14. References

- ComfyUI custom node guide: https://docs.comfy.org/custom-nodes/overview
- Crystools source (UI patterns): https://github.com/crystian/ComfyUI-Crystools
- asitop source (IOReport reference): https://github.com/tlkh/asitop
- PyTorch MPS memory API: https://pytorch.org/docs/stable/mps.html
- ComfyUI Manager submission: https://github.com/ltdrdata/ComfyUI-Manager