# CLAUDE.md

Guidance for Claude (or any AI coding agent) working on **ComfyUI-MacMonitor** — a live system performance monitor for ComfyUI on Apple Silicon.

> Read this file first. It tells you what this project is, how to work in it, and where the landmines are.

---

## What this project is

A ComfyUI custom **UI extension** that adds a real-time performance monitor bar (CPU, RAM, MPS VRAM, generation time) to the ComfyUI interface on macOS with Apple Silicon. Fills the gap left by Crystools, which is NVIDIA-only.

**This is NOT a workflow node.** It does not appear in the node search menu. It has no input/output sockets. It is not wired into the graph. It runs ambiently as a UI overlay — install it, restart ComfyUI, the bar appears. That's the entire user-facing surface.

See `ComfyUI-MacMonitor-PRD.md` for the full product spec and roadmap.

---

## Stack

- **Backend:** Python 3.10+, runs inside the ComfyUI process. Uses `psutil` and `torch.mps.*` for stats. Exposes one HTTP route via aiohttp (ComfyUI's existing server).
- **Frontend:** Vanilla JS + CSS. Registered via `app.registerExtension`. No build step. No framework.
- **Optional:** `pyobjc` for IOReport (GPU%) — only loaded if available, falls back gracefully.

No native compilation. No external services. Pure Python + JS.

---

## Repo layout

```
ComfyUI-MacMonitor/
├── __init__.py             # entry point — mounts HTTP route + WEB_DIRECTORY
├── monitor.py              # StatsCollector — pulls all metrics
├── server.py               # aiohttp route handler for /macmonitor/stats
├── execution_hooks.py      # taps into ComfyUI's PromptExecutor for gen time
├── pyproject.toml          # PEP 621 metadata for ComfyUI Manager
└── web/
    ├── monitor.js          # frontend extension (UI + polling)
    ├── monitor.css
    └── sparkline.js
```

The whole thing lives inside `ComfyUI/custom_nodes/ComfyUI-MacMonitor/` when installed.

### `__init__.py` shape

ComfyUI's loader requires these exports — keep `NODE_CLASS_MAPPINGS` empty:

```python
from .server import register_routes

register_routes()

# Required by ComfyUI's loader, but intentionally empty.
# This extension does NOT contribute workflow nodes.
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

# Tells ComfyUI to serve our JS/CSS from ./web
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
```

If you ever feel tempted to add an entry to `NODE_CLASS_MAPPINGS` — don't. The user explicitly does not want a node that gets dragged onto the canvas.

---

## Setup & dev loop

This extension runs inside a ComfyUI install, not standalone. Typical dev workflow:

```bash
# 1. Clone into your local ComfyUI's custom_nodes dir
cd ~/ComfyUI/custom_nodes
git clone <repo> ComfyUI-MacMonitor

# 2. Install Python deps into ComfyUI's venv
source ~/ComfyUI/venv/bin/activate
pip install psutil

# 3. Restart ComfyUI
cd ~/ComfyUI && python main.py

# 4. Hard-refresh browser (Cmd+Shift+R) to reload monitor.js
```

**No hot reload for Python.** Backend changes require restarting ComfyUI. Frontend changes only need a hard browser refresh.

---

## Testing

```bash
# Smoke-test the backend route while ComfyUI is running
curl http://127.0.0.1:8188/macmonitor/stats | jq

# Unit tests for stats collection (don't need ComfyUI running)
pytest tests/

# Manual verification
# - Open ComfyUI, run a workflow, watch the bar update
# - Compare values to `asitop` running in a terminal
```

There is no automated end-to-end test. Verification is manual against `asitop` ground truth.

---

## Conventions

### Python

- Type hints on all public functions (`def snapshot() -> dict[str, Any]`).
- No global state. `StatsCollector` is a class instantiated once at module load.
- All file paths absolute. Never assume cwd.
- Wrap optional imports in try/except — degradation must be graceful:

```python
try:
    from .ioreport import GPUMonitor
    _gpu_available = True
except ImportError:
    _gpu_available = False
```

### JavaScript

- Vanilla ES modules. No bundler. No TypeScript.
- One `app.registerExtension({ name: "MacMonitor", ... })` call total.
- DOM updates batched via `requestAnimationFrame` to avoid layout thrash during generation.
- Poll loop uses `setTimeout` recursion, not `setInterval`, so a slow response can't stack up requests.

### Errors

- Backend: log to ComfyUI's logger, return 200 with partial data + `errors: [...]` field. Never 500 — that breaks the frontend's polling assumptions.
- Frontend: if a fetch fails, mark the bar gray + retry with exponential backoff. Don't spam the console.

---

## Key landmines

1. **`torch.mps.current_allocated_memory()` ≠ what Activity Monitor shows.** It only reports what PyTorch has allocated, not the system-wide unified memory pressure. Always expose both `current_allocated` and `driver_allocated`. Document the difference in the README.

2. **IOReport is a private Apple framework.** It can break between macOS releases. Always wrap in try/except. If it fails, set `gpu_percent: null` and let the frontend show "—" rather than crashing.

3. **ComfyUI frontend is migrating to Vue.** Stick to `app.registerExtension` and DOM injection — those APIs are stable. Do NOT depend on internal ComfyUI components, classes, or CSS — they will be renamed.

4. **The poll loop must pause during generation** if it's adding latency. Use `is_generating` as a signal. Default to 1 Hz; drop to 0.5 Hz when generating.

5. **Apple Silicon has unified memory.** "VRAM" is a misnomer — it's a slice of the same RAM pool. Be careful with terminology in the UI to avoid confusing users coming from CUDA.

6. **`psutil.cpu_percent()` needs a non-zero `interval` on first call** or it returns 0.0. Either prime it at module load or always use the version with a kept-alive sampling loop.

7. **Don't ship `powermetrics`-based features by default.** It requires `sudo`, which means a sudoers entry. Out of scope for v1; document as advanced opt-in only.

---

## Adding a new metric

1. Add the field to `StatsCollector.snapshot()` in `monitor.py`. Use `null` if unavailable rather than omitting the key.
2. Update the JSON shape comment in `server.py`.
3. Add a cell to the bar in `monitor.js` — copy an existing cell as a template.
4. Add a CSS rule for the new cell in `monitor.css`.
5. Update README's screenshot + field reference.

---

## Releasing

1. Bump version in `pyproject.toml`.
2. Update `CHANGELOG.md`.
3. Tag: `git tag v0.x.0 && git push --tags`.
4. ComfyUI Manager picks up new versions automatically from the registered repo.

---

## Out of scope (don't accept these)

- Windows or Linux support — separate project, separate stack.
- NVIDIA support — that's Crystools' job.
- Per-process GPU breakdown — macOS doesn't expose this.
- Historical logging or export to InfluxDB/Prometheus — keep it simple.
- Replacing Activity Monitor — we're a complement, not a replacement.
- **A workflow node version.** Do not add entries to `NODE_CLASS_MAPPINGS`. Do not add input/output sockets. Do not let the user wire this into a graph. The plugin is a UI overlay, period.

---

## Useful references

- ComfyUI custom node guide: https://docs.comfy.org/custom-nodes/overview
- ComfyUI server source (for hooking PromptExecutor): `ComfyUI/server.py` and `ComfyUI/execution.py`
- Crystools (UI patterns to crib): https://github.com/crystian/ComfyUI-Crystools
- asitop (IOReport reference): https://github.com/tlkh/asitop
- PyTorch MPS memory API: https://pytorch.org/docs/stable/mps.html

---

## When in doubt

- Prefer simplicity over completeness. v1 needs to ship.
- Prefer graceful degradation over hard failures. A bar with two metrics is better than no bar.
- Prefer reading existing code (Crystools, asitop) over inventing.
- Ask the user before adding new dependencies, especially native ones.