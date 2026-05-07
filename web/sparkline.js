// Lightweight sparkline renderer (canvas, no deps).
// Wired up in v0.2 — exported here so monitor.js can adopt it without churn.

export class Sparkline {
  constructor(canvas, { max = 60, color = "#4ade80" } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.max = max;
    this.color = color;
    this.values = [];
  }

  push(v) {
    this.values.push(v);
    if (this.values.length > this.max) this.values.shift();
    this.draw();
  }

  draw() {
    const { ctx, canvas, values } = this;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (values.length < 2) return;

    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const span = hi - lo || 1;
    const stepX = w / (this.max - 1);

    ctx.beginPath();
    values.forEach((v, i) => {
      const x = i * stepX;
      const y = h - ((v - lo) / span) * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1.25;
    ctx.stroke();
  }
}
