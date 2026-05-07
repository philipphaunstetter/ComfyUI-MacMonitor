// ComfyUI-MacMonitor — frontend bar.
// Vanilla JS extension. No bundler. No framework.

import { app } from "/scripts/app.js";

const EXT_NAME = "MacMonitor";
const ROUTE = "/macmonitor/stats";
const HISTORY_LEN = 60;
const SPARK_W = 60;
const SPARK_H = 22;

// Inline styles. ComfyUI Desktop's frontend doesn't reliably honor sibling
// <link> tags injected by extension JS, so we ship CSS as a <style> string.
const STYLES = `
.macmon-bar {
  position: fixed; z-index: 10000;
  display: flex; align-items: center; gap: 8px; padding: 6px 10px;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
  font-size: 12px; line-height: 1.2;
  color: var(--input-text, #e6e6e6);
  background: var(--comfy-menu-bg, rgba(28, 28, 30, 0.92));
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));
  border-radius: 10px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  user-select: none; pointer-events: auto; transition: opacity 0.2s ease;
}
.macmon-floating   { transform: none !important; }
.macmon-hidden     { display: none !important; }
.macmon-snapping   { transition: top 80ms ease, left 80ms ease, right 80ms ease, bottom 80ms ease, transform 80ms ease; }

.macmon-grip {
  display: flex; align-items: center; justify-content: center;
  height: 14px; width: 100%; opacity: 0.45;
  font-size: 11px; letter-spacing: 0.3em; line-height: 1;
  color: inherit; cursor: default; user-select: none;
  border-radius: 4px;
}
.macmon-grip:hover { opacity: 0.8; }
.macmon-draggable .macmon-grip { cursor: grab; }
.macmon-draggable .macmon-grip:active { cursor: grabbing; }

.macmon-bar.macmon-vertical {
  flex-direction: column; align-items: stretch; gap: 4px;
  min-width: 110px; padding: 4px 8px 8px;
}
.macmon-vertical .macmon-sep    { width: auto; height: 1px; align-self: stretch; }
.macmon-vertical .macmon-spacer { display: none; }
.macmon-vertical .macmon-cell {
  flex-direction: column; align-items: center; padding: 4px 6px;
}
.macmon-vertical .macmon-cell-row {
  flex-direction: column; align-items: center; gap: 1px;
}
.macmon-vertical .macmon-spark { width: 90px; height: 24px; }
.macmon-vertical .macmon-toggle { align-self: center; padding: 2px 6px; }

.macmon-cell {
  display: inline-flex; flex-direction: column; align-items: stretch;
  gap: 2px; padding: 2px 6px; border-radius: 6px;
  white-space: nowrap; cursor: default;
}
.macmon-cell-row { display: inline-flex; align-items: baseline; gap: 6px; }
.macmon-label {
  opacity: 0.6; font-weight: 500; font-size: 10px;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.macmon-value { font-variant-numeric: tabular-nums; font-weight: 600; }
.macmon-spark {
  display: block; width: ${SPARK_W}px; height: ${SPARK_H}px;
  margin-top: 1px; opacity: 0.85;
}
.macmon-sep { width: 1px; align-self: stretch; background: var(--border-color, rgba(255, 255, 255, 0.10)); }
.macmon-spacer { width: 4px; }
.macmon-toggle {
  background: transparent; border: none; color: inherit;
  opacity: 0.5; font-size: 14px; cursor: pointer; padding: 0 4px; line-height: 1;
  align-self: center;
}
.macmon-toggle:hover { opacity: 1; }

.macmon-state-warn .macmon-value { color: #ffbf3d; }
.macmon-state-crit .macmon-value { color: #ff5d55; }
.macmon-state-warn { background: rgba(255, 191, 61, 0.08); }
.macmon-state-crit { background: rgba(255, 93, 85, 0.10); }

.macmon-running [data-cell="gen"] .macmon-value {
  color: #4ade80; animation: macmon-pulse 1.6s ease-in-out infinite;
}
@keyframes macmon-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
.macmon-stale { opacity: 0.45; }

.macmon-compact .macmon-spark { display: none; }
.macmon-compact .macmon-label { display: none; }
.macmon-compact { gap: 4px; padding: 3px 8px; font-size: 11px; }
`;

(function injectStyles() {
  if (document.getElementById("macmon-styles")) return;
  const style = document.createElement("style");
  style.id = "macmon-styles";
  style.textContent = STYLES;
  document.head.appendChild(style);
})();

const SETTINGS = {
  enabled:      "MacMonitor.Enabled",
  intervalMs:   "MacMonitor.IntervalMs",
  dock:         "MacMonitor.Dock",
  compact:      "MacMonitor.Compact",
  showSpark:    "MacMonitor.ShowSparklines",
  layout:       "MacMonitor.Layout",
  draggable:    "MacMonitor.Draggable",
  snap:         "MacMonitor.SnapToEdges",
  resetPos:     "MacMonitor.ResetPosition",
};

const DEFAULTS = {
  enabled: true,
  intervalMs: 1000,
  dock: "top-right",
  compact: false,
  showSpark: true,
  layout: "vertical",
  draggable: true,
  snap: true,
  resetPos: false,
};

// Edge offsets — top-row gets extra clearance to dodge ComfyUI's tab strip.
const EDGE = 16;
const TOP_EDGE = 36;

// 9-point anchor grid. Each anchor produces a complete CSS positioning state.
const ANCHORS = {
  "top-left":      { top: TOP_EDGE + "px", left: EDGE + "px",  right: "auto",        bottom: "auto",        transform: "none" },
  "top-center":    { top: TOP_EDGE + "px", left: "50%",        right: "auto",        bottom: "auto",        transform: "translateX(-50%)" },
  "top-right":     { top: TOP_EDGE + "px", left: "auto",       right: EDGE + "px",   bottom: "auto",        transform: "none" },
  "middle-left":   { top: "50%",           left: EDGE + "px",  right: "auto",        bottom: "auto",        transform: "translateY(-50%)" },
  "middle-center": { top: "50%",           left: "50%",        right: "auto",        bottom: "auto",        transform: "translate(-50%, -50%)" },
  "middle-right":  { top: "50%",           left: "auto",       right: EDGE + "px",   bottom: "auto",        transform: "translateY(-50%)" },
  "bottom-left":   { top: "auto",          left: EDGE + "px",  right: "auto",        bottom: EDGE + "px",   transform: "none" },
  "bottom-center": { top: "auto",          left: "50%",        right: "auto",        bottom: EDGE + "px",   transform: "translateX(-50%)" },
  "bottom-right":  { top: "auto",          left: "auto",       right: EDGE + "px",   bottom: EDGE + "px",   transform: "none" },
};

const ANCHOR_OPTIONS = [
  { text: "Top — Left",      value: "top-left" },
  { text: "Top — Center",    value: "top-center" },
  { text: "Top — Right",     value: "top-right" },
  { text: "Middle — Left",   value: "middle-left" },
  { text: "Middle — Center", value: "middle-center" },
  { text: "Middle — Right",  value: "middle-right" },
  { text: "Bottom — Left",   value: "bottom-left" },
  { text: "Bottom — Center", value: "bottom-center" },
  { text: "Bottom — Right",  value: "bottom-right" },
];

// ─── formatting ─────────────────────────────────────────────────────────────

const GB = 1024 ** 3;

function fmtBytes(n) {
  if (n == null) return "—";
  if (n >= GB) return (n / GB).toFixed(1) + " GB";
  return (n / (1024 * 1024)).toFixed(0) + " MB";
}

function fmtPct(n) {
  if (n == null) return "—";
  return Math.round(n) + "%";
}

function fmtSeconds(s) {
  if (s == null) return "—";
  if (s < 60) return s.toFixed(2) + "s";
  const m = Math.floor(s / 60);
  return `${m}m ${(s - m * 60).toFixed(0)}s`;
}

// ─── sparkline ──────────────────────────────────────────────────────────────

class Sparkline {
  constructor(canvas, { color = "#7dd3fc", fill = true, fixedMax = null } = {}) {
    this.canvas = canvas;
    this.color = color;
    this.fill = fill;
    this.fixedMax = fixedMax;
    this.values = [];
    this._resize();
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || SPARK_W;
    const h = this.canvas.clientHeight || SPARK_H;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx = this.canvas.getContext("2d");
    this.ctx.scale(dpr, dpr);
    this.w = w;
    this.h = h;
  }

  push(v) {
    this.values.push(v == null ? null : Number(v));
    while (this.values.length > HISTORY_LEN) this.values.shift();
    this.draw();
  }

  draw() {
    const { ctx, w, h, values, color, fill, fixedMax } = this;
    ctx.clearRect(0, 0, w, h);
    const pts = values.filter((v) => v != null && Number.isFinite(v));
    if (pts.length < 2) return;

    let lo = Math.min(...pts);
    let hi = fixedMax != null ? fixedMax : Math.max(...pts);
    if (fixedMax != null) lo = Math.min(lo, 0);
    const span = (hi - lo) || 1;
    const padY = 1.5;

    const stepX = w / (HISTORY_LEN - 1);
    const yFor = (v) => h - padY - ((v - lo) / span) * (h - padY * 2);

    // path
    ctx.beginPath();
    let started = false;
    let lastX = 0, lastY = h;
    values.forEach((v, i) => {
      const x = i * stepX;
      if (v == null || !Number.isFinite(v)) { started = false; return; }
      const y = yFor(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
      lastX = x; lastY = y;
    });

    if (fill) {
      ctx.lineTo(lastX, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, color + "55");
      grad.addColorStop(1, color + "00");
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // re-stroke just the line on top
    ctx.beginPath();
    started = false;
    values.forEach((v, i) => {
      const x = i * stepX;
      if (v == null || !Number.isFinite(v)) { started = false; return; }
      const y = yFor(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.lineJoin = "round";
    ctx.stroke();
  }
}

// ─── bar DOM ────────────────────────────────────────────────────────────────

function makeCell(key, label) {
  return `
    <div class="macmon-cell" data-cell="${key}">
      <div class="macmon-cell-row">
        <span class="macmon-label">${label}</span>
        <span class="macmon-value" data-field="${key}">—</span>
      </div>
      <canvas class="macmon-spark" data-spark="${key}" width="${SPARK_W}" height="${SPARK_H}"></canvas>
    </div>
  `;
}

function makeBar() {
  const root = document.createElement("div");
  root.className = "macmon-bar";
  root.innerHTML =
    `<div class="macmon-grip" data-grip aria-label="Drag handle">⋯⋯⋯</div>` +
    makeCell("cpu",  "CPU") +
    `<div class="macmon-sep"></div>` +
    makeCell("ram",  "RAM") +
    `<div class="macmon-sep"></div>` +
    makeCell("vram", "VRAM") +
    `<div class="macmon-sep"></div>` +
    makeCell("ext",  "OLLAMA") +
    `<div class="macmon-sep"></div>` +
    makeCell("gen",  "⏱") +
    `<div class="macmon-spacer"></div>` +
    `<button class="macmon-toggle" title="Hide MacMonitor">×</button>`;
  document.body.appendChild(root);

  root.querySelector(".macmon-toggle").addEventListener("click", () => {
    root.classList.toggle("macmon-hidden");
  });

  return root;
}

function makeSparks(bar) {
  return {
    cpu:  new Sparkline(bar.querySelector('[data-spark="cpu"]'),  { color: "#7dd3fc", fixedMax: 100 }),
    ram:  new Sparkline(bar.querySelector('[data-spark="ram"]'),  { color: "#a78bfa", fixedMax: 100 }),
    vram: new Sparkline(bar.querySelector('[data-spark="vram"]'), { color: "#34d399", fixedMax: 100 }),
    ext:  new Sparkline(bar.querySelector('[data-spark="ext"]'),  { color: "#f472b6", fixedMax: 100 }),
    gen:  new Sparkline(bar.querySelector('[data-spark="gen"]'),  { color: "#fbbf24" }),
  };
}

// ─── render ─────────────────────────────────────────────────────────────────

function severityForRam(used, total) {
  if (used == null || !total) return "ok";
  const r = used / total;
  if (r > 0.9) return "crit";
  if (r > 0.8) return "warn";
  return "ok";
}

function severityForVram(allocated, total) {
  if (allocated == null || !total) return "ok";
  const r = allocated / total;
  if (r > 0.95) return "crit";
  if (r > 0.8) return "warn";
  return "ok";
}

function applyState(el, state) {
  el.classList.remove("macmon-state-ok", "macmon-state-warn", "macmon-state-crit");
  el.classList.add("macmon-state-" + state);
}

let lastGenSeen = null;

function render(bar, sparks, s) {
  const fields = {};
  bar.querySelectorAll(".macmon-value").forEach((el) => (fields[el.dataset.field] = el));

  fields.cpu.textContent = fmtPct(s.cpu_percent);
  fields.ram.textContent = s.ram_total_bytes
    ? `${fmtBytes(s.ram_used_bytes)} / ${fmtBytes(s.ram_total_bytes)}`
    : fmtBytes(s.ram_used_bytes);
  // Show the higher of allocated (live tensors) and driver (reserved pool) —
  // gives a non-zero baseline when MPS has reserved memory but isn't actively using it.
  const vramShown = Math.max(s.vram_allocated_bytes ?? 0, s.vram_driver_bytes ?? 0) || null;
  fields.vram.textContent = fmtBytes(vramShown);

  // External processes (Ollama et al.) — auto-hide cell when nothing matches.
  const extBytes = s.external_memory_bytes ?? 0;
  const extProcs = s.external_processes ?? [];
  fields.ext.textContent = extBytes > 0 ? fmtBytes(extBytes) : "—";
  const extCell = bar.querySelector('[data-cell="ext"]');
  const extSep  = extCell?.previousElementSibling;
  const extVisible = extBytes > 0;
  if (extCell) extCell.style.display = extVisible ? "" : "none";
  if (extSep && extSep.classList?.contains("macmon-sep")) {
    extSep.style.display = extVisible ? "" : "none";
  }
  if (extCell) {
    extCell.title = extProcs.length
      ? extProcs.map((p) => `${p.name}: ${fmtBytes(p.rss_bytes)}`).join("\n")
      : "";
  }

  fields.gen.textContent  = s.is_generating ? "running…" : fmtSeconds(s.last_gen_seconds);

  // Per-node timing tooltip on the gen cell.
  const genCell = bar.querySelector('[data-cell="gen"]');
  const nodeTimes = s.last_run_node_times ?? [];
  if (genCell) {
    if (nodeTimes.length) {
      const top = nodeTimes.slice(0, 8)
        .map((n) => `node ${n.id}: ${n.seconds.toFixed(2)}s`)
        .join("\n");
      const more = nodeTimes.length > 8 ? `\n…and ${nodeTimes.length - 8} more` : "";
      genCell.title = `Last run — slowest nodes:\n${top}${more}`;
    } else {
      genCell.title = "";
    }
  }

  applyState(bar.querySelector('[data-cell="ram"]'),
             severityForRam(s.ram_used_bytes, s.ram_total_bytes));
  applyState(bar.querySelector('[data-cell="vram"]'),
             severityForVram(s.vram_allocated_bytes, s.ram_total_bytes));
  bar.classList.toggle("macmon-running", !!s.is_generating);
  bar.classList.remove("macmon-stale");

  // sparkline samples (percentages where applicable)
  sparks.cpu.push(s.cpu_percent);
  sparks.ram.push(
    s.ram_used_bytes != null && s.ram_total_bytes
      ? (s.ram_used_bytes / s.ram_total_bytes) * 100
      : null,
  );
  sparks.vram.push(
    vramShown != null && s.ram_total_bytes
      ? (vramShown / s.ram_total_bytes) * 100
      : null,
  );
  sparks.ext.push(
    extBytes && s.ram_total_bytes
      ? (extBytes / s.ram_total_bytes) * 100
      : 0,
  );
  // gen-time sparkline only on completion (one bar per run)
  if (s.last_gen_seconds != null && s.last_gen_seconds !== lastGenSeen) {
    sparks.gen.push(s.last_gen_seconds);
    lastGenSeen = s.last_gen_seconds;
  }
}

function markStale(bar) { bar.classList.add("macmon-stale"); }

// ─── drag + position persistence ────────────────────────────────────────────

const POS_STORAGE_KEY = "macmonitor.position";
const VIEWPORT_MARGIN = 16;
const SNAP_THRESHOLD  = 60;  // pixels from a viewport edge that triggers a snap

function loadSavedPos() {
  try {
    const raw = localStorage.getItem(POS_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p && p.type === "anchor" && typeof p.anchor === "string" && ANCHORS[p.anchor]) {
      return p;
    }
    if (p && p.type === "free" && typeof p.x === "number" && typeof p.y === "number") {
      return p;
    }
    // legacy: bare {x, y}
    if (p && typeof p.x === "number" && typeof p.y === "number") {
      return { type: "free", x: p.x, y: p.y };
    }
    return null;
  } catch { return null; }
}

function saveAnchorPos(anchor) {
  try { localStorage.setItem(POS_STORAGE_KEY, JSON.stringify({ type: "anchor", anchor })); } catch {}
}

function saveFreePos(x, y) {
  try { localStorage.setItem(POS_STORAGE_KEY, JSON.stringify({ type: "free", x, y })); } catch {}
}

function clearSavedPos() {
  try { localStorage.removeItem(POS_STORAGE_KEY); } catch {}
}

function clampToViewport(bar, x, y) {
  const r = bar.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const minX = VIEWPORT_MARGIN - r.width;
  const maxX = vw - VIEWPORT_MARGIN;
  const minY = 0;
  const maxY = vh - VIEWPORT_MARGIN;
  return {
    x: Math.max(minX, Math.min(maxX, x)),
    y: Math.max(minY, Math.min(maxY, y)),
  };
}

function clearPositionStyles(bar) {
  bar.style.top = "";
  bar.style.left = "";
  bar.style.right = "";
  bar.style.bottom = "";
  bar.style.transform = "";
}

function applyAnchorPos(bar, anchor) {
  const a = ANCHORS[anchor] || ANCHORS[DEFAULTS.dock];
  bar.classList.remove("macmon-floating");
  bar.dataset.macmonAnchor = anchor;
  Object.assign(bar.style, a);
}

function applyFloatingPos(bar, x, y) {
  const c = clampToViewport(bar, x, y);
  bar.classList.add("macmon-floating");
  delete bar.dataset.macmonAnchor;
  bar.style.left = c.x + "px";
  bar.style.top  = c.y + "px";
  bar.style.right = "auto";
  bar.style.bottom = "auto";
  bar.style.transform = "none";
}

// Decide which anchor (if any) a free position should snap to. Returns null
// when the bar is in the middle of the viewport and shouldn't snap.
function detectSnapAnchor(bar, x, y) {
  const r = bar.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const cx = x + r.width / 2;
  const cy = y + r.height / 2;

  let zoneX = "center";
  if (x < SNAP_THRESHOLD) zoneX = "left";
  else if (x + r.width > vw - SNAP_THRESHOLD) zoneX = "right";

  let zoneY = "middle";
  if (y < TOP_EDGE + SNAP_THRESHOLD) zoneY = "top";
  else if (y + r.height > vh - SNAP_THRESHOLD) zoneY = "bottom";

  // Only snap when at least one axis is at an edge — middle-center stays free.
  if (zoneX === "center" && zoneY === "middle") return null;
  return `${zoneY}-${zoneX}`;
}

function attachDrag(bar) {
  if (bar._macmonDrag) return;
  const grip = bar.querySelector("[data-grip]");
  if (!grip) return;

  let dragging = false;
  let pointerId = null;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;
  let lastSnapped = null;

  const onDown = (e) => {
    if (!bar.classList.contains("macmon-draggable")) return;
    if (e.button !== undefined && e.button !== 0) return;
    const r = bar.getBoundingClientRect();
    startLeft = r.left;
    startTop  = r.top;
    startX = e.clientX;
    startY = e.clientY;
    dragging = true;
    lastSnapped = null;
    pointerId = e.pointerId;
    try { grip.setPointerCapture(pointerId); } catch {}
    bar.classList.add("macmon-snapping");
    e.preventDefault();
  };

  const onMove = (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const x = startLeft + dx;
    const y = startTop  + dy;

    const snapEnabled = !!getSetting(SETTINGS.snap, DEFAULTS.snap);
    const anchor = snapEnabled ? detectSnapAnchor(bar, x, y) : null;

    if (anchor) {
      if (anchor !== lastSnapped) {
        applyAnchorPos(bar, anchor);
        lastSnapped = anchor;
      }
    } else {
      applyFloatingPos(bar, x, y);
      lastSnapped = null;
    }
  };

  const onUp = (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    try { grip.releasePointerCapture(pointerId); } catch {}
    bar.classList.remove("macmon-snapping");
    if (lastSnapped) {
      saveAnchorPos(lastSnapped);
    } else {
      const r = bar.getBoundingClientRect();
      saveFreePos(r.left, r.top);
    }
  };

  grip.addEventListener("pointerdown", onDown);
  grip.addEventListener("pointermove", onMove);
  grip.addEventListener("pointerup", onUp);
  grip.addEventListener("pointercancel", onUp);

  bar._macmonDrag = { onDown, onMove, onUp, grip };
}

function applyPosition(bar) {
  if (!bar) return;  // settings onChange fires before setup() — bar may not exist yet
  clearPositionStyles(bar);
  const saved = loadSavedPos();
  if (saved && saved.type === "anchor") {
    applyAnchorPos(bar, saved.anchor);
  } else if (saved && saved.type === "free") {
    applyFloatingPos(bar, saved.x, saved.y);
  } else {
    applyAnchorPos(bar, getSetting(SETTINGS.dock, DEFAULTS.dock));
  }
}

function reclampOnResize(bar) {
  if (!bar.classList.contains("macmon-floating")) return;
  const r = bar.getBoundingClientRect();
  const c = clampToViewport(bar, r.left, r.top);
  applyFloatingPos(bar, c.x, c.y);
  saveFreePos(c.x, c.y);
}

// ─── polling ────────────────────────────────────────────────────────────────

class Poller {
  constructor(bar, sparks, getInterval, getEnabled) {
    this.bar = bar;
    this.sparks = sparks;
    this.getInterval = getInterval;
    this.getEnabled = getEnabled;
    this.backoff = 0;
    this._timer = null;
    this._inflight = false;
  }

  start()           { this._schedule(0); }
  stop()            { if (this._timer) clearTimeout(this._timer); this._timer = null; }

  _schedule(delayOverride) {
    if (this._timer) clearTimeout(this._timer);
    const base = this.getEnabled() ? this.getInterval() : 5000;
    const delay = delayOverride != null ? delayOverride : base + this.backoff;
    this._timer = setTimeout(() => this._tick(), delay);
  }

  async _tick() {
    if (!this.getEnabled() || this._inflight) { this._schedule(); return; }
    this._inflight = true;
    try {
      const res = await fetch(ROUTE, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      requestAnimationFrame(() => render(this.bar, this.sparks, data));
      this.backoff = 0;
    } catch (e) {
      requestAnimationFrame(() => markStale(this.bar));
      this.backoff = Math.min(30_000, this.backoff ? this.backoff * 2 : 1000);
    } finally {
      this._inflight = false;
      this._schedule();
    }
  }
}

// ─── extension registration ─────────────────────────────────────────────────

let bar = null;
let sparks = null;
let poller = null;
let initialized = false;  // ComfyUI fires onChange during registration; ignore until setup() runs.

function getSetting(key, fallback) {
  try {
    const v = app.ui?.settings?.getSettingValue?.(key);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function applyLayout() {
  if (!bar) return;
  const vertical = getSetting(SETTINGS.layout, DEFAULTS.layout) === "vertical";
  bar.classList.toggle("macmon-vertical", vertical);
  // Canvas pixel sizes change with the new CSS dimensions; rebake at next frame
  // once layout has settled, otherwise sparklines render stretched/blurred.
  if (sparks) {
    requestAnimationFrame(() => {
      Object.values(sparks).forEach((sp) => { sp._resize(); sp.draw(); });
    });
  }
}

function applyDragMode() {
  if (!bar) return;
  const draggable = !!getSetting(SETTINGS.draggable, DEFAULTS.draggable);
  bar.classList.toggle("macmon-draggable", draggable);
}

function applyVisibility() {
  if (!bar) return;
  bar.style.display = getSetting(SETTINGS.enabled, DEFAULTS.enabled) ? "" : "none";
  bar.classList.toggle("macmon-compact", !!getSetting(SETTINGS.compact, DEFAULTS.compact));
  applyLayout();
  applyPosition(bar);
  applyDragMode();
  const showSpark = !!getSetting(SETTINGS.showSpark, DEFAULTS.showSpark);
  bar.querySelectorAll(".macmon-spark").forEach((c) => {
    c.style.display = showSpark ? "" : "none";
  });
}

function handleLayoutChange() {
  if (!initialized) return;
  // Layout flip can leave a previously-saved coord that no longer fits — reset.
  clearSavedPos();
  applyLayout();
  applyPosition(bar);
}

function handleResetPosition(value) {
  if (!initialized || !value) return;
  clearSavedPos();
  applyPosition(bar);
  // Toggle the setting back to false so it acts like a button.
  try { app.ui?.settings?.setSettingValue?.(SETTINGS.resetPos, false); } catch {}
}

function handleDockChange() {
  if (!initialized) return;
  // Picking a dock from the dropdown is an explicit override — discard any
  // previous drag/snap position so the new dock actually takes effect.
  clearSavedPos();
  applyPosition(bar);
}

app.registerExtension({
  name: EXT_NAME,
  settings: [
    { id: SETTINGS.enabled,    name: "Show monitor bar", type: "boolean",
      defaultValue: DEFAULTS.enabled,   onChange: applyVisibility },
    { id: SETTINGS.intervalMs, name: "Poll interval",    type: "combo",
      defaultValue: DEFAULTS.intervalMs,
      options: [{ text: "0.5s", value: 500 }, { text: "1s", value: 1000 }, { text: "2s", value: 2000 }] },
    { id: SETTINGS.dock,       name: "Dock",             type: "combo",
      defaultValue: DEFAULTS.dock,
      options: ANCHOR_OPTIONS,
      onChange: handleDockChange },
    { id: SETTINGS.compact,    name: "Compact mode",     type: "boolean",
      defaultValue: DEFAULTS.compact,   onChange: applyVisibility },
    { id: SETTINGS.showSpark,  name: "Show sparklines",  type: "boolean",
      defaultValue: DEFAULTS.showSpark, onChange: applyVisibility },
    { id: SETTINGS.layout,     name: "Layout",           type: "combo",
      defaultValue: DEFAULTS.layout,
      options: [{ text: "Vertical", value: "vertical" }, { text: "Horizontal", value: "horizontal" }],
      onChange: handleLayoutChange },
    { id: SETTINGS.draggable,  name: "Allow dragging",   type: "boolean",
      defaultValue: DEFAULTS.draggable, onChange: applyDragMode },
    { id: SETTINGS.snap,       name: "Snap to edges when dragging", type: "boolean",
      defaultValue: DEFAULTS.snap,      onChange: () => {} },
    { id: SETTINGS.resetPos,   name: "Reset bar position", type: "boolean",
      defaultValue: DEFAULTS.resetPos,  onChange: handleResetPosition },
  ],

  async setup() {
    bar = makeBar();
    sparks = makeSparks(bar);
    attachDrag(bar);
    initialized = true;
    applyVisibility();
    window.addEventListener("resize", () => reclampOnResize(bar));
    poller = new Poller(
      bar, sparks,
      () => Number(getSetting(SETTINGS.intervalMs, DEFAULTS.intervalMs)) || DEFAULTS.intervalMs,
      () => !!getSetting(SETTINGS.enabled, DEFAULTS.enabled),
    );
    poller.start();
  },
});
