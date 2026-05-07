# ComfyUI-MacMonitor

Live system performance monitor for ComfyUI on Apple Silicon (MPS). Fills the gap left by Crystools (NVIDIA-only).

A thin, ambient bar pinned to the ComfyUI canvas showing **CPU**, **RAM**, **MPS VRAM**, and **last generation time** — visible *while a workflow runs*.

> This is a **UI-only** extension. There is no node to drag onto the canvas. Install, restart ComfyUI, the bar appears.

---

## Install

### Via ComfyUI Manager (recommended once published)

Search for `MacMonitor` in ComfyUI Manager and install.

### Manual

```bash
cd ~/ComfyUI/custom_nodes
git clone <repo-url> ComfyUI-MacMonitor
source ~/ComfyUI/venv/bin/activate
pip install psutil
# restart ComfyUI, then hard-refresh the browser (Cmd+Shift+R)
```

## What you get

```
 CPU 34%  │  RAM 18.2 GB / 64 GB  │  VRAM 11.4 GB  │  ⏱ 4.21s
```

- Updates at **1 Hz** by default (configurable: 0.5s / 1s / 2s).
- Bar turns yellow at high RAM/VRAM, red near OOM.
- Generation cell pulses green and reads `running…` while a workflow executes, then shows total seconds when done.

## Settings

ComfyUI Settings → MacMonitor:

| Setting | Default | |
|---|---|---|
| Show monitor bar | on | toggle visibility |
| Poll interval | 1s | 0.5s / 1s / 2s |
| Position | top | top / bottom |
| Compact mode | off | hides labels |

## Notes on MPS memory

- **VRAM** shown is `torch.mps.current_allocated_memory()` — what PyTorch is actively using. The driver reserve (`driver_allocated_memory()`) is also collected and exposed via the API.
- Apple Silicon uses **unified memory**: "VRAM" is a slice of the same RAM pool. The bar reports both so you can see the relationship.

## API

Single endpoint:

```
GET /macmonitor/stats
```

```json
{
  "ts": 1714940000.123,
  "chip": "Apple Silicon",
  "cpu_percent": 34.2,
  "cpu_per_core": [22, 41, 18],
  "ram_used_bytes": 19541230080,
  "ram_total_bytes": 68719476736,
  "vram_allocated_bytes": 12230590464,
  "vram_driver_bytes": 13510000000,
  "gpu_percent": null,
  "last_gen_seconds": 4.21,
  "is_generating": false
}
```

## Roadmap

- **v0.1 (now):** CPU, RAM, VRAM, gen time, settings panel.
- **v0.2:** GPU% via IOReport, sparklines, per-node timings.
- **v0.3:** Optional `powermetrics` (power/temp), session export.

See `ComfyUI-MacMonitor-PRD.md` for the full plan.

## License

MIT
