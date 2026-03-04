/**
 * 15-story-multi-column.overlay.mjs
 *
 * Visual diagnostics for multi-column story layout.  All marks live in the
 * margins or as non-text tints so the underlying content remains legible.
 * The annotations directly correspond to each assertion in
 * assertStoryMultiColumnSignals.
 *
 *   Column spines       — dashed vertical rules at every distinct X anchor
 *                         found among text boxes, colour-coded by story:
 *                           blue-500    = 2-column story  (mc2-* sourceIds)
 *                           emerald-500 = 3-column story  (mc3-* sourceIds)
 *                           amber-500   = 5-column lists  (no story prefix)
 *
 *   Gutter fill         — translucent rect between adjacent column spines
 *                         confirming the configured gutter width.
 *
 *   Column badges       — "C1" / "C2" / "C3" pills above each spine on
 *                         the page where the story first appears, showing
 *                         the resolved X anchors the test validates.
 *
 *   Obstacle frame      — dashed rect at the image / box boundary; a larger
 *                         semi-transparent fill shows the exclusion zone
 *                         (obstacle bounds expanded by the declared gap).
 *
 *   Gap callout         — "gap N pt" label next to the clearance expansion.
 *
 *   Obstacle pill       — short sourceId label above each obstacle.
 *
 *   Line-width bars     — behind every wrapped text line in a column story:
 *                         a thin horizontal bar whose width mirrors the
 *                         measured line width (from _lineWidths), offset by
 *                         _lineOffsets.  Full-width lines are not marked.
 *                         Visually confirms the wrap-variance the test checks.
 *
 *   Source-ID labels    — 4 pt pill in the left margin for every box that
 *                         carries a sourceId.
 *
 *   Content-area outline— faint dashed rect showing the inferred usable area.
 *
 *   Page header         — "page N · <story description>" in the top gutter.
 *
 *   Legend              — compact key on page 1, bottom-right corner.
 */

const COL2_COLOR = '#3b82f6';   // blue-500   — 2-column story
const COL3_COLOR = '#10b981';   // emerald-500 — 3-column story
const COL5_COLOR = '#f59e0b';   // amber-500  — 5-column / plain flow

const GUTTER_ALPHA   = 0.06;
const OBSTACLE_ALPHA = 0.11;
const WRAP_ALPHA     = 0.20;

function storyColor(sourceId) {
  const s = String(sourceId || '');
  if (s.startsWith('mc2-')) return COL2_COLOR;
  if (s.startsWith('mc3-')) return COL3_COLOR;
  return COL5_COLOR;
}

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Last segment of a colon-separated sourceId string. */
function shortId(sourceId) {
  if (!sourceId) return '';
  const parts = String(sourceId).split(':');
  return parts[parts.length - 1];
}

/** Draw a small filled label pill. */
function pill(ctx, label, x, y, color, fontSize = 5) {
  const pad = 2;
  const tw  = label.length * fontSize * 0.58;
  const pw  = tw + pad * 2;
  const ph  = fontSize + pad * 2;
  ctx.save();
  ctx.fillColor(color).opacity(0.82);
  ctx.rect(x, y, pw, ph).fill();
  ctx.fillColor('#ffffff').opacity(1);
  ctx.font('Helvetica', fontSize);
  ctx.text(label, x + pad, y + pad + 0.5, { lineBreak: false });
  ctx.restore();
}

export default {
  overlay(page, ctx) {
    const boxes = page.boxes;
    if (!boxes || boxes.length === 0) return;

    const LEFT_EDGE = boxes.reduce(
      (min, b) => (safeNum(b.x) > 0 && safeNum(b.x) < min ? safeNum(b.x) : min),
      page.width
    );
    const RIGHT_EDGE = page.width - LEFT_EDGE;

    const contentBoxes = boxes.filter(b => safeNum(b.h) > 0);
    const colTop = contentBoxes.length
      ? Math.min(...contentBoxes.map(b => safeNum(b.y)))
      : LEFT_EDGE;
    const colBot = contentBoxes.length
      ? Math.max(...contentBoxes.map(b => safeNum(b.y) + safeNum(b.h)))
      : page.height - LEFT_EDGE;
    const contentH = Math.max(1, colBot - colTop);

    // ── Content-area outline ─────────────────────────────────────────────────
    ctx.save();
    ctx.strokeColor('#94a3b8').lineWidth(0.3).dash(5, { space: 5 }).opacity(0.14);
    ctx.rect(LEFT_EDGE, colTop, RIGHT_EDGE - LEFT_EDGE, contentH).stroke();
    ctx.undash();
    ctx.restore();

    // ── Gather text boxes by story family ────────────────────────────────────
    const textBoxes  = boxes.filter(b => Array.isArray(b.lines) && b.lines.length > 0);
    const mc2Boxes   = textBoxes.filter(b => String(b.meta?.sourceId || '').startsWith('mc2-'));
    const mc3Boxes   = textBoxes.filter(b => String(b.meta?.sourceId || '').startsWith('mc3-'));
    const otherBoxes = textBoxes.filter(
      b => !String(b.meta?.sourceId || '').startsWith('mc2-') &&
           !String(b.meta?.sourceId || '').startsWith('mc3-')
    );

    // ── Helper: draw column spines + gutter fills for a group ────────────────
    function drawColumnSpines(group, color) {
      if (group.length === 0) return;
      // Round to 1 decimal to merge near-identical anchors.
      const xSet = [...new Set(group.map(b => Number(safeNum(b.x).toFixed(1))))].sort((a, b2) => a - b2);

      // Gutter fills between adjacent spines.
      ctx.save();
      ctx.fillColor(color).opacity(GUTTER_ALPHA);
      for (let i = 0; i + 1 < xSet.length; i++) {
        const rightOfLeft = xSet[i] + safeNum(
          group.find(b => Number(safeNum(b.x).toFixed(1)) === xSet[i])?.w,
          0
        );
        const leftOfRight = xSet[i + 1];
        if (leftOfRight > rightOfLeft + 0.5) {
          ctx.rect(rightOfLeft, colTop, leftOfRight - rightOfLeft, contentH).fill();
        }
      }
      ctx.restore();

      // Spine lines.
      ctx.save();
      ctx.strokeColor(color).lineWidth(0.6).dash(4, { space: 3 }).opacity(0.45);
      xSet.forEach(x => {
        ctx.moveTo(x, colTop).lineTo(x, colBot).stroke();
      });
      ctx.undash();
      ctx.restore();

      // Column-anchor badges above each spine.
      xSet.forEach((x, i) => {
        pill(ctx, `C${i + 1}`, x + 1, Math.max(2, colTop - 10), color, 5);
      });
    }

    drawColumnSpines(mc2Boxes,   COL2_COLOR);
    drawColumnSpines(mc3Boxes,   COL3_COLOR);
    drawColumnSpines(otherBoxes, COL5_COLOR);

    // ── Obstacle annotation ──────────────────────────────────────────────────
    boxes.forEach(ob => {
      const sid = String(ob.meta?.sourceId || '');
      if (!sid.includes('mc2-obstacle-') && !sid.includes('mc3-obstacle-')) return;

      const x   = safeNum(ob.x);
      const y   = safeNum(ob.y);
      const w   = safeNum(ob.w);
      const h   = safeNum(ob.h);
      const gap = safeNum(ob.properties?.layout?.gap ?? ob.meta?.gap, 8);
      const color = storyColor(sid);

      // Exclusion zone.
      ctx.save();
      ctx.fillColor(color).opacity(OBSTACLE_ALPHA);
      ctx.rect(x - gap, y - gap, w + gap * 2, h + gap * 2).fill();
      ctx.restore();

      // Obstacle frame.
      ctx.save();
      ctx.strokeColor(color).lineWidth(0.9).dash(3, { space: 2 }).opacity(0.65);
      ctx.rect(x, y, w, h).stroke();
      ctx.undash();
      ctx.restore();

      // sourceId pill above the obstacle.
      pill(ctx, shortId(sid), x, Math.max(2, y - 10), color, 4.5);

      // Gap callout to the right of the exclusion zone.
      ctx.save();
      ctx.fillColor(color).opacity(0.72);
      ctx.font('Helvetica', 4.5);
      ctx.text(`gap ${gap} pt`, x + w + 2, y + 2, { lineBreak: false });
      ctx.restore();
    });

    // ── Line-width variance bars ─────────────────────────────────────────────
    // Draw a thin tinted bar behind every wrapped line in a column story box.
    // This directly visualises the variance checked by wrappedVariance assertion.
    [...mc2Boxes, ...mc3Boxes].forEach(box => {
      const lineWidths  = box.properties?._lineWidths;
      const lineOffsets = box.properties?._lineOffsets;
      if (!Array.isArray(lineWidths) || lineWidths.length < 2) return;

      const boxX    = safeNum(box.x);
      const boxY    = safeNum(box.y);
      const color   = storyColor(String(box.meta?.sourceId || ''));
      const barColor = color === COL3_COLOR ? '#d97706' : color; // amber tint for mc3 variety
      const maxW    = Math.max(...lineWidths.map(n => safeNum(n)));
      const fontSize = safeNum(box.style?.fontSize, 10);
      const lh      = fontSize * safeNum(box.style?.lineHeight, 1.4);

      lineWidths.forEach((rawW, idx) => {
        const lw     = safeNum(rawW);
        const offset = Array.isArray(lineOffsets) ? safeNum(lineOffsets[idx]) : 0;
        if (offset <= 0.1 && (maxW - lw) <= 4) return; // skip full-width lines

        const barX = boxX + offset;
        const barY = boxY + idx * lh;
        ctx.save();
        ctx.fillColor(barColor).opacity(WRAP_ALPHA);
        ctx.rect(barX, barY, Math.max(1, lw), 1.4).fill();
        ctx.restore();
      });
    });

    // ── Source-ID margin labels ──────────────────────────────────────────────
    boxes.forEach(box => {
      const sid = shortId(String(box.meta?.sourceId || ''));
      if (!sid) return;
      const y     = safeNum(box.y);
      const color = storyColor(sid);
      ctx.save();
      ctx.fillColor(color).opacity(0.6);
      ctx.font('Helvetica', 4);
      ctx.text(sid, 2, y + 1, { lineBreak: false, width: LEFT_EDGE - 4 });
      ctx.restore();
    });

    // ── Page header ──────────────────────────────────────────────────────────
    let storyLabel;
    if (mc2Boxes.length > 0 && mc3Boxes.length > 0) storyLabel = '2-col + 3-col';
    else if (mc2Boxes.length > 0)                    storyLabel = '2-col story';
    else if (mc3Boxes.length > 0)                    storyLabel = '3-col story';
    else                                             storyLabel = '5-col lists';

    ctx.save();
    ctx.fillColor('#475569').opacity(0.65);
    ctx.font('Helvetica', 6);
    ctx.text(`page ${page.index + 1}  ·  ${storyLabel}`, LEFT_EDGE, 6, { lineBreak: false });
    ctx.restore();

    // ── Legend (page 1 only) ─────────────────────────────────────────────────
    if (page.index !== 0) return;

    const ROW_H = 9;
    const ROWS  = 5;
    const lw    = 168;
    const lh    = ROWS * ROW_H + 18;
    const lx    = RIGHT_EDGE - lw;
    const ly    = page.height - LEFT_EDGE - lh;

    ctx.save();
    ctx.fillColor('#f8fafc').opacity(0.93);
    ctx.rect(lx, ly, lw, lh).fill();
    ctx.strokeColor('#cbd5e1').lineWidth(0.5).opacity(0.6);
    ctx.rect(lx, ly, lw, lh).stroke();
    ctx.restore();

    ctx.save();
    ctx.fillColor('#1e293b').opacity(0.9);
    ctx.font('Helvetica-Bold', 6.5);
    ctx.text('Overlay key', lx + 4, ly + 4, { lineBreak: false });
    ctx.restore();

    ctx.save();
    ctx.strokeColor('#cbd5e1').lineWidth(0.4).opacity(0.5);
    ctx.moveTo(lx, ly + 13).lineTo(lx + lw, ly + 13).stroke();
    ctx.restore();

    const legendRows = [
      { color: COL2_COLOR, label: 'Blue  — 2-col story (mc2-*) spine + gutter' },
      { color: COL3_COLOR, label: 'Green — 3-col story (mc3-*) spine + gutter' },
      { color: COL5_COLOR, label: 'Amber — 5-col lists / plain-flow anchors' },
      { color: COL2_COLOR, label: 'Dashed box + fill = obstacle + exclusion zone' },
      { color: '#d97706',  label: 'Bar tint = wrapped line (offset > 0)' },
    ];

    legendRows.forEach(({ color, label }, i) => {
      const ry = ly + 16 + i * ROW_H;
      ctx.save();
      ctx.fillColor(color).opacity(0.82);
      ctx.rect(lx + 4, ry, 8, 6).fill();
      ctx.restore();
      ctx.save();
      ctx.fillColor('#374151').opacity(0.88);
      ctx.font('Helvetica', 5.5);
      ctx.text(label, lx + 15, ry + 0.5, { lineBreak: false });
      ctx.restore();
    });
  },
};
