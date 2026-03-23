// VMPrint Specimen Blueprint — Overlay v2
//
// Palette (print / warm paper):
//   INK    (#1a0800) — rules, ticks, leaders
//   DIM    (#6b5040) — secondary labels
//   RUST   (#b84c20) — bounding boxes, obstacles
//   NAVY   (#1e3a5f) — column guides, structural
//   TEAL   (#0d6b7a) — baselines, metric rules
//   CLARET (#7a3a52) — drop-cap, accent badges

const INK    = "#1a0800";
const DIM    = "#6b5040";
const RUST   = "#b84c20";
const NAVY   = "#1e3a5f";
const TEAL   = "#0d6b7a";
const CLARET = "#7a3a52";
const WHITE  = "#fdf6e3";

// Optical scales declared in the document (must match layout.opticalScaling)
const OPT_SCALE = { arabic: 0.92, thai: 0.92, devanagari: 0.95, cjk: 0.88, latin: 1.0 };

function safeN(v, fallback) {
  var n = Number(v);
  return Number.isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
}

function getLine(box, idx) {
  idx = idx === undefined ? 0 : idx;
  var m = box && box.properties && box.properties.__vmprintTextMetrics;
  if (!m || !Array.isArray(m.lines)) return null;
  var l = m.lines[idx];
  if (!l) return null;
  var baseline = safeN(l.baseline, NaN);
  if (!Number.isFinite(baseline)) return null;
  return { top: safeN(l.top), baseline: baseline, bottom: safeN(l.bottom),
           ascent: Math.max(0, safeN(l.ascent)), descent: Math.max(0, safeN(l.descent)),
           fontSize: safeN(l.fontSize, 10) };
}

// Walk box.lines[lineIdx] to accumulate X positions of each segment.
// Returns array of {text, x, width, direction} in page coords.
function getSegmentPositions(box, lineIdx) {
  lineIdx = lineIdx === undefined ? 0 : lineIdx;
  var rawLines = box && box.lines;
  if (!rawLines || !Array.isArray(rawLines[lineIdx])) return [];
  var segs = rawLines[lineIdx];
  var lm = getLine(box, lineIdx);
  var curX = safeN(box.x);
  // For RTL boxes the segments may be reversed; handle direction per-segment.
  var result = [];
  for (var i = 0; i < segs.length; i++) {
    var seg = segs[i];
    var w = safeN(seg.width);
    result.push({ text: seg.text || '', x: curX, width: w, direction: seg.direction || 'ltr' });
    curX += w;
  }
  return result;
}

// ─── Primitives ────────────────────────────────────────────────────────────

function lbl(ctx, x, y, text, size, opacity, color) {
  size    = size    === undefined ? 5.0 : size;
  opacity = opacity === undefined ? 0.82 : opacity;
  color   = color   === undefined ? INK  : color;
  ctx.save();
  ctx.font("Helvetica", size).fillColor(color).opacity(opacity);
  ctx.text(text, x, y, { lineBreak: false });
  ctx.restore();
}

function lblBold(ctx, x, y, text, size, opacity, color) {
  size    = size    === undefined ? 5.2 : size;
  opacity = opacity === undefined ? 0.90 : opacity;
  color   = color   === undefined ? INK  : color;
  ctx.save();
  ctx.font("Helvetica-Bold", size).fillColor(color).opacity(opacity);
  ctx.text(text, x, y, { lineBreak: false });
  ctx.restore();
}

function hRule(ctx, y, x1, x2, label, color, opacity) {
  color   = color   === undefined ? TEAL  : color;
  opacity = opacity === undefined ? 0.55  : opacity;
  ctx.save();
  ctx.strokeColor(color).lineWidth(0.28).opacity(opacity);
  ctx.moveTo(x1, y).lineTo(x2, y).stroke();
  ctx.moveTo(x1, y - 2.5).lineTo(x1, y + 2.5).stroke();
  ctx.moveTo(x2, y - 2.5).lineTo(x2, y + 2.5).stroke();
  ctx.restore();
  if (label) lbl(ctx, x2 + 5, y - 4, label, 4.8, opacity * 0.9, color);
}

function dashRect(ctx, x, y, w, h, color, opacity, dash, gap) {
  dash = dash === undefined ? 2.2 : dash;
  gap  = gap  === undefined ? 1.6 : gap;
  ctx.save();
  ctx.strokeColor(color).lineWidth(0.35).opacity(opacity)
     .dash(dash, { space: gap }).rect(x, y, w, h).stroke().undash();
  ctx.restore();
}

// Solid filled accent rectangle (very transparent — used for highlighting)
function fillRect(ctx, x, y, w, h, color, opacity) {
  ctx.save();
  ctx.fillColor(color).opacity(opacity).rect(x, y, w, h).fill();
  ctx.restore();
}

function vDim(ctx, x, y1, y2, label, color) {
  color = color === undefined ? TEAL : color;
  var h = y2 - y1;
  if (h < 3) return;
  var tip = 2.4;
  ctx.save();
  ctx.strokeColor(color).lineWidth(0.30).opacity(0.48);
  ctx.moveTo(x, y1).lineTo(x, y2).stroke();
  ctx.moveTo(x, y1).lineTo(x - tip * 0.6, y1 + tip).stroke();
  ctx.moveTo(x, y1).lineTo(x + tip * 0.6, y1 + tip).stroke();
  ctx.moveTo(x, y2).lineTo(x - tip * 0.6, y2 - tip).stroke();
  ctx.moveTo(x, y2).lineTo(x + tip * 0.6, y2 - tip).stroke();
  ctx.restore();
  if (label) {
    ctx.save();
    ctx.translate(x - 3, y1 + h * 0.5);
    ctx.rotate(-90);
    ctx.font("Helvetica", 4.6).fillColor(color).opacity(0.50);
    ctx.text(label, -(label.length * 1.45), 0, { lineBreak: false });
    ctx.restore();
  }
}

function hDim(ctx, x1, x2, y, label, color) {
  color = color === undefined ? TEAL : color;
  if (x2 - x1 < 3) return;
  ctx.save();
  ctx.strokeColor(color).lineWidth(0.26).opacity(0.44);
  ctx.moveTo(x1, y).lineTo(x2, y).stroke();
  ctx.moveTo(x1, y - 4).lineTo(x1, y + 4).stroke();
  ctx.moveTo(x2, y - 4).lineTo(x2, y + 4).stroke();
  ctx.restore();
  if (label) lbl(ctx, (x1 + x2) / 2 - label.length * 1.4, y - 7, label, 4.6, 0.48, color);
}

// Corner-mark bracket on a corner of a rect (quadrant: 'tl','tr','bl','br')
function cornerMark(ctx, x, y, w, h, color, opacity, armLen) {
  armLen = armLen === undefined ? 6 : armLen;
  opacity = opacity === undefined ? 0.60 : opacity;
  ctx.save();
  ctx.strokeColor(color).lineWidth(0.30).opacity(opacity);
  ctx.moveTo(x, y + armLen).lineTo(x, y).lineTo(x + armLen, y).stroke(); // tl
  ctx.moveTo(x + w - armLen, y).lineTo(x + w, y).lineTo(x + w, y + armLen).stroke(); // tr
  ctx.moveTo(x, y + h - armLen).lineTo(x, y + h).lineTo(x + armLen, y + h).stroke(); // bl
  ctx.moveTo(x + w - armLen, y + h).lineTo(x + w, y + h).lineTo(x + w, y + h - armLen).stroke(); // br
  ctx.restore();
}

// Callout leader: horizontal arm from (lx, ly) to right, then text.
function callout(ctx, lx, ly, armLen, text, color, opacity, textSize) {
  color    = color    === undefined ? RUST  : color;
  opacity  = opacity  === undefined ? 0.78  : opacity;
  textSize = textSize === undefined ? 5.0   : textSize;
  ctx.save();
  ctx.strokeColor(color).lineWidth(0.28).opacity(opacity);
  ctx.moveTo(lx, ly).lineTo(lx + armLen, ly).stroke();
  ctx.moveTo(lx, ly - 2.0).lineTo(lx, ly + 2.0).stroke();
  ctx.restore();
  var tx = armLen >= 0 ? lx + armLen + 2 : lx + armLen - 2;
  lbl(ctx, tx, ly - 5.5, text, textSize, opacity * 1.1, color);
}

function badge(ctx, cx, cy, n, color) {
  color = color === undefined ? RUST : color;
  var r = 4.8;
  ctx.save();
  ctx.fillColor(color).opacity(0.90);
  ctx.roundedRect(cx - r, cy - r, r * 2, r * 2, 1.4).fill();
  ctx.restore();
  ctx.save();
  ctx.font("Helvetica-Bold", 5.8).fillColor(WHITE).opacity(1);
  var s = String(n);
  ctx.text(s, cx - (s.length * 1.7), cy - 2.1, { lineBreak: false });
  ctx.restore();
}

// Hatch fill (diagonal lines) for exclusion zones
function hatch(ctx, x, y, w, h, color, opacity, spacing) {
  spacing = spacing === undefined ? 5 : spacing;
  ctx.save();
  ctx.strokeColor(color).lineWidth(0.22).opacity(opacity);
  var diag = w + h;
  for (var d = -h; d < w; d += spacing) {
    var x1 = x + d, y1 = y;
    var x2 = x + d + h, y2 = y + h;
    if (x1 < x) { y1 += x - x1; x1 = x; }
    if (x2 > x + w) { y2 -= x2 - (x + w); x2 = x + w; }
    if (y1 > y2) continue;
    ctx.moveTo(x1, y1).lineTo(x2, y2).stroke();
  }
  ctx.restore();
}

// Small optical-scale bar: a pair of horizontal lines showing 1.0× vs scale×
function optBar(ctx, x, y, scriptName, scale, fontSize, color) {
  var fullH  = fontSize * 0.75;
  var scaledH = fullH * scale;
  var barW   = 28;

  ctx.save();
  // ghost bar (1.0x reference)
  ctx.strokeColor(DIM).lineWidth(0.25).opacity(0.30);
  ctx.moveTo(x, y - fullH).lineTo(x + barW, y - fullH).stroke();
  ctx.moveTo(x, y - fullH).lineTo(x, y).stroke();
  ctx.moveTo(x + barW, y - fullH).lineTo(x + barW, y).stroke();
  ctx.restore();

  ctx.save();
  // actual bar (scale×)
  ctx.fillColor(color).opacity(0.15);
  ctx.rect(x + 1, y - scaledH, barW - 2, scaledH).fill();
  ctx.strokeColor(color).lineWidth(0.40).opacity(0.60);
  ctx.moveTo(x, y - scaledH).lineTo(x + barW, y - scaledH).stroke();
  ctx.restore();

  lbl(ctx, x,          y - fullH - 6, "1.0\u00d7",   4.4, 0.32, DIM);
  lblBold(ctx, x,      y - scaledH - 6, scale.toFixed(2) + "\u00d7", 4.6, 0.72, color);
  lbl(ctx, x + barW + 3, y - scaledH * 0.5 - 2, scriptName, 5.0, 0.70, color);
}

// ─── Page 1 ────────────────────────────────────────────────────────────────

function renderPage1(page, ctx) {
  var boxes = Array.isArray(page.boxes) ? page.boxes : [];
  var lm = 50; var rm = page.width - 50;

  var titleBox    = null;
  var dropCapBox  = null;
  var floatBox    = null;
  var bodyBoxes   = [];

  for (var i = 0; i < boxes.length; i++) {
    var b = boxes[i];
    if (b.type === 'pageTitle')   titleBox   = b;
    if (b.type === 'dropcap')     dropCapBox = b;
    if (b.type === 'obstacleImg') floatBox   = b;
    if (b.type === 'body')        bodyBoxes.push(b);
  }

  // ── Title ghost baseline ───────────────────────────────────────────────
  if (titleBox) {
    var tl0 = getLine(titleBox, 0);
    if (tl0) {
      ctx.save();
      ctx.strokeColor(TEAL).lineWidth(0.18).opacity(0.07);
      ctx.moveTo(lm - 10, tl0.baseline).lineTo(rm + 10, tl0.baseline).stroke();
      ctx.restore();
    }
  }

  // ── Story column guides (derived from content boxes) ──────────────────
  {
    var sx = lm; var sy = 9999; var storyBottom = 0;
    var allStoryBoxes = bodyBoxes.concat(dropCapBox ? [dropCapBox] : []);
    for (var k = 0; k < allStoryBoxes.length; k++) {
      var bk = allStoryBoxes[k];
      var bkY = safeN(bk.y); var bkH = safeN(bk.h);
      if (bkY < sy) sy = bkY;
      if (bkY + bkH > storyBottom) storyBottom = bkY + bkH;
    }
    if (sy === 9999) sy = 103;
    var sw = rm - lm; var sh = storyBottom - sy;
    var colW = (sw - 24) / 3; // gutter 12 × 2 = 24

    // Dashed column dividers
    for (var c = 1; c <= 2; c++) {
      var divX = sx + colW * c + 12 * c - 6;
      ctx.save();
      ctx.strokeColor(NAVY).lineWidth(0.20).dash(0.8, { space: 3.5 }).opacity(0.25);
      ctx.moveTo(divX, sy - 2).lineTo(divX, sy + sh + 2).stroke().undash();
      ctx.restore();
    }

    // Column width callouts above the story
    for (var cc = 0; cc < 3; cc++) {
      var cLeft = sx + cc * (colW + 12);
      hDim(ctx, cLeft, cLeft + colW, sy - 8, colW.toFixed(0) + " pt", NAVY);
      lbl(ctx, cLeft + colW * 0.5 - 9, sy - 18, "COL " + (cc + 1), 4.5, 0.32, NAVY);
    }

    // Column-flow arrows at bottom of gutter midpoints
    var arrowY = sy + sh + 4;
    for (var ac = 0; ac < 2; ac++) {
      var arrowX = sx + colW * (ac + 1) + 12 * ac + 6;
      ctx.save();
      ctx.strokeColor(NAVY).lineWidth(0.30).opacity(0.30);
      ctx.moveTo(arrowX - 5, arrowY).lineTo(arrowX + 5, arrowY).stroke();
      ctx.moveTo(arrowX + 5, arrowY).lineTo(arrowX + 2.2, arrowY - 2.6).stroke();
      ctx.moveTo(arrowX + 5, arrowY).lineTo(arrowX + 2.2, arrowY + 2.6).stroke();
      ctx.restore();
      lbl(ctx, arrowX - 5, arrowY + 3.5, "FLOW", 4.0, 0.28, NAVY);
    }

    // Story bounding box (faint)
    dashRect(ctx, sx, sy, sw, sh, NAVY, 0.10, 1.0, 4.0);
  }

  // ── Drop-cap anatomy ──────────────────────────────────────────────────
  if (dropCapBox) {
    var dc0 = getLine(dropCapBox, 0);
    var dcX = safeN(dropCapBox.x); var dcY = safeN(dropCapBox.y);
    var dcW = safeN(dropCapBox.w); var dcH = safeN(dropCapBox.h);

    dashRect(ctx, dcX, dcY, dcW, dcH, CLARET, 0.50, 1.8, 1.6);

    if (dc0) {
      var capTop  = dc0.baseline - dc0.ascent;
      var capBase = dc0.baseline;

      hRule(ctx, capTop,  lm - 8, rm + 8, "CAP HEIGHT", TEAL, 0.52);
      hRule(ctx, capBase, lm - 8, rm + 8, "BASELINE",   TEAL, 0.60);

      vDim(ctx, lm - 18, capTop, capBase, dc0.ascent.toFixed(1) + " pt", TEAL);

      badge(ctx, dcX + dcW * 0.5, capTop,  1, CLARET);
      badge(ctx, dcX + dcW * 0.5, capBase, 2, CLARET);

      callout(ctx, dcX + dcW, dcY + dcH * 0.4, rm - dcX - dcW + 8,
        "[drop-cap \u00b7 E]  x:" + dcX.toFixed(1) + "  y:" + dcY.toFixed(1) +
        "  " + dcW.toFixed(1) + "\u00d7" + dcH.toFixed(1), CLARET, 0.80, 4.8);
    }
  }

  // ── Float obstacle ────────────────────────────────────────────────────
  if (floatBox) {
    var fx = safeN(floatBox.x); var fy = safeN(floatBox.y);
    var fw = safeN(floatBox.w); var fh = safeN(floatBox.h);
    var fgap = 10; // matches document gap

    // Draw obstacle box visual — box is an image so we render content via overlay
    ctx.save();
    ctx.strokeColor('#7a5c34').lineWidth(0.7).opacity(1);
    ctx.rect(fx, fy, fw, fh).stroke();
    ctx.restore();
    var obstacleLines = [
      'ACTOR  story-float',
      'ORIGIN ' + Math.round(fx) + ', ' + Math.round(fy),
      'SIZE   ' + fw.toFixed(0) + ' \u00d7 ' + fh.toFixed(0) + ' pt',
      'WRAP   around',
      'GAP    10 pt'
    ];
    var olLineH = 6.2 * 1.75;
    ctx.save();
    ctx.fillColor('#4a2c0a').opacity(1);
    for (var li = 0; li < obstacleLines.length; li++) {
      ctx.font('Courier', 6.2);
      ctx.text(obstacleLines[li], fx + 9, fy + 7 + li * olLineH, { lineBreak: false });
    }
    ctx.restore();

    // Exclusion zone hatch (float rect + gap)
    hatch(ctx, fx, fy, fw + fgap, fh, RUST, 0.12, 4.5);

    // Exclusion zone boundary (larger dashed rect)
    dashRect(ctx, fx - 1, fy - 1, fw + fgap + 2, fh + 2, RUST, 0.28, 3.0, 2.0);
    lbl(ctx, fx + 1, fy + fh + 4, "EXCL. FIELD  " + (fw + fgap) + " \u00d7 " + fh + " pt",
      4.5, 0.38, RUST);

    // Float box corners + outline
    cornerMark(ctx, fx, fy, fw, fh, RUST, 0.72, 6);
    dashRect(ctx, fx, fy, fw, fh, RUST, 0.70, 2.6, 1.8);

    // Dimension arrows
    vDim(ctx, fx - 12, fy, fy + fh, fh.toFixed(1) + " pt", RUST);
    hDim(ctx, fx, fx + fw, fy - 8, fw.toFixed(1) + " pt", RUST);

    badge(ctx, fx + fw * 0.5, fy + fh + 14, 3, RUST);

    callout(ctx, fx + fw, fy + fh * 0.4, rm - fx - fw + 8,
      "[story-float]  wrap:around  gap:" + fgap + " pt", RUST, 0.80, 4.8);
  }

  // ── Body text ascender reference ──────────────────────────────────────
  var firstFullBody = null;
  for (var k = 0; k < bodyBoxes.length; k++) {
    if (bodyBoxes[k] !== dropCapBox) { firstFullBody = bodyBoxes[k]; break; }
  }
  if (firstFullBody) {
    var bm0 = getLine(firstFullBody, 0);
    if (bm0) {
      var aY = bm0.baseline - bm0.ascent;
      ctx.save();
      ctx.strokeColor(DIM).lineWidth(0.18).dash(1.0, { space: 3 }).opacity(0.22);
      ctx.moveTo(safeN(firstFullBody.x), aY)
         .lineTo(safeN(firstFullBody.x) + safeN(firstFullBody.w), aY).stroke().undash();
      ctx.restore();
      lbl(ctx, safeN(firstFullBody.x) + safeN(firstFullBody.w) + 5, aY - 4, "ASCENDER",
        4.5, 0.28, DIM);
    }
  }

  // ── Margin ruler annotations ──────────────────────────────────────────
  hDim(ctx, 0, lm, page.height - 34 + 10, "L 50 pt", NAVY);
  hDim(ctx, rm, page.width, page.height - 34 + 10, "R 50 pt", NAVY);
}

// ─── Page 2 ────────────────────────────────────────────────────────────────

function renderPage2(page, ctx) {
  var boxes = Array.isArray(page.boxes) ? page.boxes : [];
  var lm = 50; var rm = page.width - 50;

  var tableCells = [];
  var mixedBox   = null;
  var stressBox  = null;

  for (var i = 0; i < boxes.length; i++) {
    var b = boxes[i];
    if (b.type === 'table_cell') tableCells.push(b);
    if (b.type === 'mixedBlock') mixedBox  = b;
    if (b.type === 'stressPara') stressBox = b;
  }

  // ── Table: header bracket, colSpan, rowSpan ───────────────────────────
  if (tableCells.length > 0) {
    var tableMinY = tableCells.reduce(function(m, b) { return Math.min(m, safeN(b.y)); }, 9999);
    var tableMaxY = tableCells.reduce(function(m, b) { return Math.max(m, safeN(b.y) + safeN(b.h)); }, 0);
    var tableX = lm; var tableW = rm - lm;

    dashRect(ctx, tableX, tableMinY, tableW, tableMaxY - tableMinY, NAVY, 0.15, 1.2, 3.5);
    lblBold(ctx, tableX, tableMinY - 8, "SIMULATION REPORT", 5.5, 0.55, NAVY);
    hDim(ctx, tableX, tableX + tableW, tableMinY - 14, tableW.toFixed(0) + " pt \u00b7 5 flex cols", NAVY);

    // Header row bracket on right edge
    var headerCells = tableCells.filter(function(b) { return Math.abs(safeN(b.y) - tableMinY) < 1; });
    if (headerCells.length > 0) {
      var headerH = safeN(headerCells[0].h);
      ctx.save();
      ctx.strokeColor(NAVY).lineWidth(0.22).opacity(0.40);
      ctx.moveTo(tableX + tableW + 2, tableMinY).lineTo(tableX + tableW + 10, tableMinY).stroke();
      ctx.moveTo(tableX + tableW + 2, tableMinY + headerH).lineTo(tableX + tableW + 10, tableMinY + headerH).stroke();
      ctx.moveTo(tableX + tableW + 10, tableMinY).lineTo(tableX + tableW + 10, tableMinY + headerH).stroke();
      ctx.restore();
      lbl(ctx, tableX + tableW + 12, tableMinY + headerH * 0.4,
        "HEADER \u00b7 repeatHeader: true", 4.5, 0.55, NAVY);
    }

    // colSpan cells — single cell spanning full table width
    var colSpanCells = tableCells.filter(function(b) { return safeN(b.w) > tableW * 0.7; });
    for (var csi = 0; csi < colSpanCells.length; csi++) {
      var csc = colSpanCells[csi];
      callout(ctx, safeN(csc.x) + safeN(csc.w), safeN(csc.y) + safeN(csc.h) * 0.5, 10,
        "colSpan: 5", RUST, 0.60, 4.5);
    }

    // rowSpan cells — taller than normal
    var normalH = 17.1;
    var rowSpanCells = tableCells.filter(function(b) { return safeN(b.h) > normalH * 1.4; });
    for (var rsi = 0; rsi < rowSpanCells.length; rsi++) {
      var rsc = rowSpanCells[rsi];
      vDim(ctx, safeN(rsc.x) - 9, safeN(rsc.y), safeN(rsc.y) + safeN(rsc.h), "rowSpan: 2", RUST);
    }
  }

  // ── mixedBlock: shared baseline + per-script labels ────────────────────
  if (mixedBox) {
    var ml0 = getLine(mixedBox, 0);
    if (ml0) {
      ctx.save();
      ctx.strokeColor(TEAL).lineWidth(0.50).opacity(0.60);
      ctx.moveTo(lm - 8, ml0.baseline).lineTo(rm + 8, ml0.baseline).stroke();
      ctx.restore();
      hRule(ctx, ml0.baseline, rm + 10, rm + 14, "SHARED BASELINE", TEAL, 0.60);
      vDim(ctx, lm - 18, ml0.baseline - ml0.ascent, ml0.baseline, ml0.ascent.toFixed(1) + " pt", TEAL);
    }

    // Script segment annotations — identify by Unicode range
    var segs = getSegmentPositions(mixedBox, 0);
    var scriptDefs = [
      { re: /[\u0600-\u06FF]/, name: "ARABIC \u25c0 0.92\u00d7", color: RUST        },
      { re: /[\u0E00-\u0E7F]/, name: "THAI 0.92\u00d7",          color: "#1a5c1a"   },
      { re: /[\u3000-\u9FFF]/, name: "CJK 0.88\u00d7",           color: "#1a1a5a"   },
      { re: /[\u0900-\u097F]/, name: "DEVA 0.95\u00d7",          color: "#3a1a5a"   }
    ];
    var annotatedScripts = {};
    for (var sii = 0; sii < segs.length; sii++) {
      var seg = segs[sii];
      var t = seg.text; if (!t || safeN(seg.width) < 2) continue;
      for (var sci = 0; sci < scriptDefs.length; sci++) {
        var sd = scriptDefs[sci];
        if (sd.re.test(t) && !annotatedScripts[sd.name]) {
          annotatedScripts[sd.name] = true;
          if (ml0) {
            ctx.save();
            ctx.strokeColor(sd.color).lineWidth(0.35).opacity(0.40);
            ctx.moveTo(seg.x, ml0.baseline + 2).lineTo(seg.x + seg.width, ml0.baseline + 2).stroke();
            ctx.restore();
            lbl(ctx, seg.x, ml0.baseline - ml0.ascent - 7, sd.name, 4.3, 0.70, sd.color);
            var gW = ml0.fontSize * 0.68;
            var gTop = ml0.baseline - ml0.ascent;
            dashRect(ctx, seg.x, gTop, gW, ml0.ascent + Math.max(1, ml0.descent), sd.color, 0.50, 1.2, 1.0);
          }
          break;
        }
      }
    }
    // Annotate "Precision" as LATIN showcase
    for (var si2 = 0; si2 < segs.length; si2++) {
      if (segs[si2].text && segs[si2].text.trim() === 'Precision' && ml0) {
        ctx.save();
        ctx.strokeColor(INK).lineWidth(0.30).opacity(0.28);
        ctx.moveTo(segs[si2].x, ml0.baseline + 2).lineTo(segs[si2].x + segs[si2].width, ml0.baseline + 2).stroke();
        ctx.restore();
        lbl(ctx, segs[si2].x, ml0.baseline - ml0.ascent - 7, "LATIN 1.00\u00d7", 4.3, 0.55, DIM);
        break;
      }
    }
  }

  // ── stressPara: size-variance + baseline stability ─────────────────────
  if (stressBox) {
    var sbX = safeN(stressBox.x); var sbY = safeN(stressBox.y);
    var sbW = safeN(stressBox.w);
    lbl(ctx, sbX, sbY - 8, "SIZE VARIANCE  8\u202f\u2013\u202f16 pt  \u2014  one computed baseline per line", 4.8, 0.62, DIM);

    var stressMeta = stressBox.properties && stressBox.properties.__vmprintTextMetrics;
    var nLines = stressMeta && Array.isArray(stressMeta.lines) ? stressMeta.lines.length : 0;
    for (var li = 0; li < nLines; li++) {
      var sLine = getLine(stressBox, li);
      if (!sLine) continue;
      ctx.save();
      ctx.strokeColor(TEAL).lineWidth(0.26).opacity(0.45);
      ctx.moveTo(sbX + sbW + 2, sLine.baseline).lineTo(sbX + sbW + 8, sLine.baseline).stroke();
      ctx.restore();
    }
    var sLine0 = getLine(stressBox, 0);
    if (sLine0) {
      callout(ctx, sbX + sbW, sLine0.baseline, 10, "ALIGNED", TEAL, 0.72, 4.5);
    }
  }

  // ── Margin rulers ──────────────────────────────────────────────────────
  hDim(ctx, 0, lm, page.height - 34 + 10, "L 50 pt", NAVY);
  hDim(ctx, rm, page.width, page.height - 34 + 10, "R 50 pt", NAVY);
}

// ─── Export ────────────────────────────────────────────────────────────────

export default {

  backdrop(page, ctx) {
    var lm = 50; var rm = page.width - 50;
    var tm = 34; var bm = page.height - 34;

    // Baseline rhythm grid — 10pt body × 1.35 = 13.5 pt
    var step = 13.5;
    ctx.save();
    ctx.strokeColor(INK).lineWidth(0.16).dash(0.5, { space: 6 }).opacity(0.04);
    for (var y = tm; y < bm; y += step) {
      ctx.moveTo(lm, y).lineTo(rm, y).stroke();
    }
    ctx.undash();
    ctx.restore();

    // Page margin frame
    ctx.save();
    ctx.strokeColor(NAVY).lineWidth(0.20).dash(1.5, { space: 4 }).opacity(0.10);
    ctx.rect(lm, tm, rm - lm, bm - tm).stroke().undash();
    ctx.restore();
  },

  overlay(page, ctx) {
    if (page.index === 0) renderPage1(page, ctx);
    if (page.index === 1) renderPage2(page, ctx);
  }

};
