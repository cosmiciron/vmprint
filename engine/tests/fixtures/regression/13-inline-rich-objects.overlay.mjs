/**
 * 13-inline-rich-objects.overlay.mjs
 *
 * Diagnostics for rich inline object flow across wraps and pages:
 * - Baseline + ascent/descent bands on lines that contain inline objects.
 * - Object-slot highlights and ordered connectors (O1 -> O2 -> O3 -> O4).
 * - Run badges ("R{n}") and continuation fragment badges ("F{n}").
 * - Page summary headers with object counts.
 */

const SLOT_STYLES = {
  1: { key: "telemetry", label: "O1", color: "#0ea5e9" },
  2: { key: "settings", label: "O2", color: "#22c55e" },
  3: { key: "status", label: "O3", color: "#f59e0b" },
  4: { key: "snapshot", label: "O4", color: "#8b5cf6" },
  default: { key: "object", label: "O?", color: "#475569" },
};

const runBySource = new Map();
let globalObjectSerial = 0;

function safeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function textNoBreak(ctx, str, x, y, size = 5.5, color = "#334155", opacity = 0.85) {
  ctx.save();
  ctx.fillColor(color).opacity(opacity).font("Helvetica", size);
  ctx.text(str, x, y, { lineBreak: false });
  ctx.restore();
}

function hasObjectReplacementChar(text) {
  if (!text) return false;
  for (const ch of text) {
    if (ch.codePointAt(0) === 0xfffc) return true;
  }
  return false;
}

function isInlineObjectSegment(seg) {
  if (!seg) return false;
  if (hasObjectReplacementChar(String(seg.text || ""))) return true;

  const family = String(seg.fontFamily || "").trim();
  const ascent = Number(seg.ascent || 0);
  const descent = Number(seg.descent || 0);

  // Defensive fallback for object-like inline runs.
  return !family && ascent >= 1000 && descent <= 100;
}

function sourceKeyForBox(box, pageIndex, boxIndex) {
  const sourceId = box?.meta?.sourceId ?? box?.meta?.originSourceId;
  if (sourceId != null && String(sourceId).length > 0) return String(sourceId);
  return `p${pageIndex}-b${boxIndex}`;
}

function runFromText(text) {
  if (!text) return null;
  const m = /Run\s+(\d+)\s+telemetry/i.exec(text);
  return m ? Number(m[1]) : null;
}

function slotStyle(slotIndex) {
  return SLOT_STYLES[slotIndex] || SLOT_STYLES.default;
}

export default {
  overlay(page, ctx) {
    const boxes = Array.isArray(page.boxes) ? page.boxes : [];
    if (!boxes.length) return;

    const leftEdge = boxes.reduce((min, b) => (b.x > 0 && b.x < min ? b.x : min), page.width);
    const rightEdge = page.width - leftEdge;
    const contentTop = boxes.reduce((min, b) => Math.min(min, b.y), page.height);
    const contentBottom = boxes.reduce((max, b) => Math.max(max, b.y + b.h), 0);

    let pageObjectCount = 0;
    let pageRunCount = 0;
    const seenRuns = new Set();

    // Content frame guides.
    ctx.save();
    ctx.strokeColor("#94a3b8").lineWidth(0.3).dash(5, { space: 5 }).opacity(0.18);
    ctx.rect(leftEdge, contentTop, rightEdge - leftEdge, contentBottom - contentTop).stroke();
    ctx.undash();
    ctx.restore();

    // Legend on first page.
    if (page.index === 0) {
      const rowH = 9;
      const rows = 7;
      const legendW = 186;
      const legendH = rows * rowH + 16;
      const legendX = rightEdge - legendW;
      const legendY = page.height - leftEdge - legendH;

      ctx.save();
      ctx.fillColor("#f8fafc").opacity(0.95);
      ctx.rect(legendX, legendY, legendW, legendH).fill();
      ctx.strokeColor("#94a3b8").lineWidth(0.5).opacity(0.6);
      ctx.rect(legendX, legendY, legendW, legendH).stroke();
      ctx.restore();

      textNoBreak(ctx, "Inline Rich Objects Overlay", legendX + 4, legendY + 3, 6.3, "#374151", 0.92);

      ctx.save();
      ctx.strokeColor("#cbd5e1").lineWidth(0.4).opacity(0.85);
      ctx.moveTo(legendX, legendY + 12).lineTo(legendX + legendW, legendY + 12).stroke();
      ctx.restore();

      const ix = legendX + 4;
      const tx = legendX + 30;
      const rowY = (i) => legendY + 16 + i * rowH;

      // Row 0: baseline.
      {
        const y = rowY(0);
        ctx.save();
        ctx.strokeColor("#ef4444").lineWidth(0.7).opacity(0.6);
        ctx.moveTo(ix, y + 4).lineTo(ix + 20, y + 4).stroke();
        ctx.restore();
        textNoBreak(ctx, "line baseline", tx, y + 1);
      }

      // Row 1: line bands.
      {
        const y = rowY(1);
        ctx.save();
        ctx.fillColor("#f59e0b").opacity(0.16);
        ctx.rect(ix, y, 20, 4).fill();
        ctx.fillColor("#38bdf8").opacity(0.16);
        ctx.rect(ix, y + 4, 20, 4).fill();
        ctx.restore();
        textNoBreak(ctx, "ascent / descent bands", tx, y + 1);
      }

      // Row 2: order connector.
      {
        const y = rowY(2);
        ctx.save();
        ctx.strokeColor("#64748b").lineWidth(0.6).dash(2, { space: 2 }).opacity(0.75);
        ctx.moveTo(ix, y + 4).lineTo(ix + 20, y + 4).stroke();
        ctx.undash();
        ctx.restore();
        textNoBreak(ctx, "reading-order connector", tx, y + 1);
      }

      // Row 3-6: slot colors.
      [
        SLOT_STYLES[1],
        SLOT_STYLES[2],
        SLOT_STYLES[3],
        SLOT_STYLES[4],
      ].forEach((style, i) => {
        const y = rowY(3 + i);
        ctx.save();
        ctx.fillColor(style.color).opacity(0.62);
        ctx.roundedRect(ix, y + 1, 20, 7, 2).fill();
        ctx.restore();
        textNoBreak(ctx, `${style.label} ${style.key}`, tx, y + 1);
      });
    }

    boxes.forEach((box, boxIndex) => {
      const metrics = box.properties?.__vmprintTextMetrics;
      if (!metrics?.lines || !Array.isArray(box.lines) || box.lines.length === 0) return;

      const sourceKey = sourceKeyForBox(box, page.index, boxIndex);
      const rawText = box.lines.map((line) => line.map((seg) => String(seg.text || "")).join("")).join(" ");

      const discoveredRun = runFromText(rawText);
      if (discoveredRun != null) runBySource.set(sourceKey, discoveredRun);
      const runId = discoveredRun ?? runBySource.get(sourceKey) ?? null;

      if (runId != null) seenRuns.add(runId);

      const fragIndex = safeNumber(box.meta?.fragmentIndex, 0);
      const isContinuation = box.meta?.isContinuation === true || fragIndex > 0;

      // Highlight continuation seams for split paragraph fragments.
      if (isContinuation) {
        ctx.save();
        ctx.strokeColor("#0f766e").lineWidth(0.8).dash(3, { space: 2 }).opacity(0.75);
        ctx.moveTo(box.x, box.y).lineTo(box.x + box.w, box.y).stroke();
        ctx.undash();
        ctx.restore();

        const fragLabel = `F${fragIndex}`;
        const bw = 16;
        const bh = 8;
        const bx = leftEdge - bw - 4;
        const by = box.y + 1;
        ctx.save();
        ctx.fillColor("#0f766e").opacity(0.82);
        ctx.roundedRect(bx, by, bw, bh, 2).fill();
        ctx.fillColor("#ffffff").opacity(1).font("Helvetica", 5.2);
        ctx.text(fragLabel, bx + 4, by + 1.5, { lineBreak: false });
        ctx.restore();
      }

      if (runId != null) {
        const runLabel = `R${runId}`;
        const bw = Math.ceil(runLabel.length * 3.6 + 8);
        const bh = 8;
        const bx = leftEdge - bw - 4;
        const by = box.y + (isContinuation ? 11 : 1);
        ctx.save();
        ctx.fillColor("#334155").opacity(0.84);
        ctx.roundedRect(bx, by, bw, bh, 2).fill();
        ctx.fillColor("#ffffff").opacity(1).font("Helvetica", 5.2);
        ctx.text(runLabel, bx + 3, by + 1.5, { lineBreak: false });
        ctx.restore();
      }

      const contentX = safeNumber(metrics.contentBox?.x, box.x);
      let slotIndexInBox = 0;
      let previousObjectCenter = null;

      box.lines.forEach((line, li) => {
        const lineMeta = metrics.lines?.[li];
        if (!lineMeta || !Array.isArray(line) || line.length === 0) return;

        const lineObjects = line
          .map((seg, idx) => ({ seg, idx }))
          .filter(({ seg }) => isInlineObjectSegment(seg));
        if (!lineObjects.length) return;

        const lineTop = safeNumber(lineMeta.top, box.y);
        const lineH = safeNumber(lineMeta.height, box.h);
        const baseline = safeNumber(lineMeta.baseline, lineTop + lineH * 0.8);
        const ascent = safeNumber(lineMeta.ascent, Math.max(1, lineH * 0.7));
        const descent = safeNumber(lineMeta.descent, Math.max(1, lineH * 0.25));
        const lineWidth = line.reduce((sum, seg) => sum + safeNumber(seg.width, 0), 0);

        // Geometry bands and baseline for object-bearing lines only.
        ctx.save();
        ctx.fillColor("#f59e0b").opacity(0.08);
        ctx.rect(contentX, baseline - ascent, lineWidth, ascent).fill();
        ctx.fillColor("#38bdf8").opacity(0.08);
        ctx.rect(contentX, baseline, lineWidth, descent).fill();
        ctx.restore();

        ctx.save();
        ctx.strokeColor("#ef4444").lineWidth(0.55).opacity(0.5);
        ctx.moveTo(contentX, baseline).lineTo(contentX + lineWidth, baseline).stroke();
        ctx.restore();

        let segX = contentX;
        line.forEach((seg) => {
          const segW = safeNumber(seg.width, 0);
          if (segW <= 0) return;

          if (!isInlineObjectSegment(seg)) {
            segX += segW;
            return;
          }

          slotIndexInBox += 1;
          pageObjectCount += 1;
          globalObjectSerial += 1;

          const style = slotStyle(slotIndexInBox);
          const segAscent = Math.max(
            2,
            (safeNumber(seg.ascent, 1000) / 1000) * safeNumber(lineMeta.fontSize, 12)
          );
          const segDescent = Math.max(
            0,
            (safeNumber(seg.descent, 0) / 1000) * safeNumber(lineMeta.fontSize, 12)
          );
          const inkTop = baseline - segAscent;
          const inkH = Math.max(2, segAscent + segDescent);
          const cx = segX + segW / 2;
          const cy = baseline;

          // Slot fill in line box.
          ctx.save();
          ctx.fillColor(style.color).opacity(0.11);
          ctx.rect(segX, lineTop, segW, lineH).fill();
          ctx.restore();

          // Estimated ink bounds.
          ctx.save();
          ctx.strokeColor(style.color).lineWidth(0.75).dash(2, { space: 2 }).opacity(0.9);
          ctx.rect(segX, inkTop, segW, inkH).stroke();
          ctx.undash();
          ctx.restore();

          // Baseline center tick.
          ctx.save();
          ctx.strokeColor(style.color).lineWidth(0.6).opacity(0.75);
          ctx.moveTo(cx, baseline - 3).lineTo(cx, baseline + 3).stroke();
          ctx.restore();

          // Reading-order connector.
          if (previousObjectCenter) {
            ctx.save();
            ctx.strokeColor("#64748b").lineWidth(0.55).dash(2, { space: 2 }).opacity(0.5);
            ctx.moveTo(previousObjectCenter.x, previousObjectCenter.y)
              .lineTo(cx, cy)
              .stroke();
            ctx.undash();
            ctx.restore();
          }
          previousObjectCenter = { x: cx, y: cy };

          const runTag = runId != null ? `R${runId}` : "R?";
          textNoBreak(
            ctx,
            `${runTag}${style.label}`,
            segX + 1,
            lineTop - 6,
            4.8,
            style.color,
            0.78
          );

          textNoBreak(
            ctx,
            `#${globalObjectSerial}`,
            segX + 1,
            baseline + Math.max(3, descent) + 1.5,
            4.8,
            "#334155",
            0.62
          );

          segX += segW;
        });
      });
    });

    pageRunCount = seenRuns.size;

    // Page header summary.
    const gutterY = Math.max(8, leftEdge / 2);
    ctx.save();
    ctx.strokeColor("#cbd5e1").lineWidth(0.35).opacity(0.7);
    ctx.moveTo(leftEdge, gutterY + 4).lineTo(rightEdge, gutterY + 4).stroke();
    ctx.restore();
    textNoBreak(ctx, `page ${page.index + 1}`, leftEdge, gutterY, 6, "#94a3b8", 0.8);
    textNoBreak(
      ctx,
      `${pageObjectCount} objects | ${pageRunCount} runs`,
      rightEdge - 80,
      gutterY,
      6,
      "#64748b",
      0.8
    );
  },
};

