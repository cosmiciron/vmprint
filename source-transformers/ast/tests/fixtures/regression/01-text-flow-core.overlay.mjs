/**
 * 01-text-flow-core.overlay.mjs
 *
 * Backdrop: 72 pt margin guide lines in slate.
 * Overlay:  element-type colour-coded bounding boxes.
 *
 *   h1  → solid blue
 *   h2  → teal
 *   p   → light slate (dashed)
 *   blockquote → amber
 */
const TYPE_COLOURS = {
  h1:         { stroke: '#1a73e8', width: 1.2, dash: null },
  h2:         { stroke: '#00897b', width: 1.0, dash: null },
  p:          { stroke: '#94a3b8', width: 0.6, dash: [3, 4] },
  blockquote: { stroke: '#d97706', width: 1.0, dash: [6, 3] },
};

export default {
  backdrop(page, ctx) {
    const m = 72; // assumed margin — matches fixture layout.margins
    ctx.save();
    ctx.strokeColor('#cbd5e1').lineWidth(0.4).dash(2, { space: 6 }).opacity(0.6);
    // top margin
    ctx.moveTo(0, m).lineTo(page.width, m).stroke();
    // bottom margin
    ctx.moveTo(0, page.height - m).lineTo(page.width, page.height - m).stroke();
    // left margin
    ctx.moveTo(m, 0).lineTo(m, page.height).stroke();
    // right margin
    ctx.moveTo(page.width - m, 0).lineTo(page.width - m, page.height).stroke();
    ctx.undash();
    ctx.restore();
  },

  overlay(page, ctx) {
    for (const box of page.boxes) {
      const cfg = TYPE_COLOURS[box.type];
      if (!cfg) continue;

      ctx.save();
      ctx.strokeColor(cfg.stroke).lineWidth(cfg.width).opacity(0.75);
      if (cfg.dash) ctx.dash(cfg.dash[0], { space: cfg.dash[1] });
      ctx.rect(box.x, box.y, box.w, box.h).stroke();
      if (cfg.dash) ctx.undash();

      // Type label in top-left corner
      ctx.fillColor(cfg.stroke).opacity(0.85);
      ctx.font('Helvetica', 6.5);
      ctx.text(box.type, box.x + 2, box.y + 7);
      ctx.restore();
    }
  }
};
