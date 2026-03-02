// VMPrint Manifesto Hero — Overlay
//
// Design language: typographic specimen book / anatomy diagram.
// Inspired by FF DIN specimen layouts — full-width metric rules
// at precise font-derived positions, numbered callout badges,
// and a numbered annotation key in the corner.
//
// No bezier curves. All geometry is rectilinear.
//
// Colour palette — Morandi / editorial:
//   INK    (#0f2942) — rules, ticks, arrows
//   DIM    (#6a5848) — secondary label text (warm umber-gray)
//   ACCENT (#7a3a52) — callout badges (deep dusty claret)
//   WHITE  (#ffffff) — badge numerals

const INK = '#0f2942';
const DIM = '#6a5848';
const ACCENT = '#7a3a52';
const WHITE = '#ffffff';

function safeN(v, fallback) {
    fallback = fallback === undefined ? 0 : fallback;
    var n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function getMetricsLine(box, idx) {
    idx = idx === undefined ? 0 : idx;
    var m = box && box.properties && box.properties.__vmprintTextMetrics;
    if (!m || !Array.isArray(m.lines)) return null;
    var l = m.lines[idx];
    if (!l) return null;
    var baseline = safeN(l.baseline, NaN);
    if (!Number.isFinite(baseline)) return null;
    return {
        baseline: baseline,
        ascent: Math.max(0, safeN(l.ascent, 0)),
        descent: Math.max(0, safeN(l.descent, 0)),
    };
}

// ─── Primitives ────────────────────────────────────────────────

// Numbered badge circle — the specimen-book callout markers.
//
// Vertical centering math:
//   PDFKit text(str, x, y): y = top of the text line box (above ascender).
//   At 6pt Helvetica-Bold, cap height ≈ 4.3pt. The visual midpoint of a
//   capital numeral sits at y + (ascender_ratio * fontSize / 2) ≈ y + 2.15.
//   To place that midpoint at cy: y = cy - 2.15.
//
// Horizontal centering:
//   Helvetica-Bold numerals ≈ 0.55 em wide = 0.55 × 6 = 3.3pt each.
//   Left edge = cx - (count × 3.3 / 2) = cx - (count × 1.65).
function badge(ctx, cx, cy, n) {
    var r = 5.5;
    ctx.save();
    ctx.fillColor(ACCENT).opacity(0.92);
    ctx.roundedRect(cx - r, cy - r, r * 2, r * 2, r).fill();
    ctx.restore();

    ctx.save();
    ctx.font('Helvetica-Bold', 6.0).fillColor(WHITE).opacity(1);
    var s = String(n);
    ctx.text(s, cx - s.length * 1.65, cy - 2.15, { lineBreak: false });
    ctx.restore();
}

// Full-width horizontal metric rule with serif end-ticks.
//
// Label is positioned RIGHT of the right tick, inside the right margin.
// xb must be set so that (xb + LABEL_GAP + labelWidth) stays within
// the page edge — the caller controls xb.
var LABEL_GAP = 5;
function metricRule(ctx, y, xa, xb, label, opacity) {
    opacity = opacity === undefined ? 0.52 : opacity;

    ctx.save();
    ctx.strokeColor(INK).lineWidth(0.32).opacity(opacity);
    ctx.moveTo(xa, y).lineTo(xb, y).stroke();
    ctx.moveTo(xa, y - 3.5)
        .lineTo(xa, y + 3.5)
        .stroke(); // left tick
    ctx.moveTo(xb, y - 3.5)
        .lineTo(xb, y + 3.5)
        .stroke(); // right tick
    ctx.restore();

    if (label) {
        ctx.save();
        ctx.font('Helvetica', 5.2)
            .fillColor(INK)
            .opacity(opacity * 0.9);
        ctx.text(label, xb + LABEL_GAP, y - 4, { lineBreak: false });
        ctx.restore();
    }
}

// Double-headed vertical dimension arrow with a rotated measurement label.
function vDim(ctx, x, y1, y2, label) {
    var h = y2 - y1;
    if (h < 5) return;
    var tip = 2.8;

    ctx.save();
    ctx.strokeColor(INK).lineWidth(0.4).opacity(0.52);
    ctx.moveTo(x, y1).lineTo(x, y2).stroke();
    ctx.moveTo(x, y1)
        .lineTo(x - tip * 0.55, y1 + tip)
        .stroke();
    ctx.moveTo(x, y1)
        .lineTo(x + tip * 0.55, y1 + tip)
        .stroke();
    ctx.moveTo(x, y2)
        .lineTo(x - tip * 0.55, y2 - tip)
        .stroke();
    ctx.moveTo(x, y2)
        .lineTo(x + tip * 0.55, y2 - tip)
        .stroke();
    ctx.lineWidth(0.28).opacity(0.35);
    ctx.moveTo(x - 5, y1)
        .lineTo(x + 5, y1)
        .stroke();
    ctx.moveTo(x - 5, y2)
        .lineTo(x + 5, y2)
        .stroke();
    ctx.restore();

    // Rotated label centred on the arrow shaft.
    ctx.save();
    ctx.translate(x - 3.2, y1 + h * 0.5);
    ctx.rotate(-90);
    ctx.font('Helvetica', 5.0).fillColor(INK).opacity(0.5);
    ctx.text(label, -(label.length * 1.55), 0, { lineBreak: false });
    ctx.restore();
}

// Small annotation label — Latin-only (Helvetica has no CJK/Arabic glyphs).
function lbl(ctx, x, y, text, size, opacity) {
    size = size === undefined ? 5.2 : size;
    opacity = opacity === undefined ? 0.68 : opacity;
    ctx.save();
    ctx.font('Helvetica', size).fillColor(DIM).opacity(opacity);
    ctx.text(text, x, y, { lineBreak: false });
    ctx.restore();
}

// Short leftward direction arrow — used for the RTL indicator.
function rtlArrow(ctx, x, y, shaftLen) {
    var tip = 3;
    ctx.save();
    ctx.strokeColor(INK).lineWidth(0.38).opacity(0.5);
    ctx.moveTo(x, y)
        .lineTo(x + shaftLen, y)
        .stroke();
    ctx.moveTo(x, y)
        .lineTo(x + tip, y - 2.2)
        .stroke();
    ctx.moveTo(x, y)
        .lineTo(x + tip, y + 2.2)
        .stroke();
    ctx.restore();
}

// ─── Main export ───────────────────────────────────────────────

export default {
    backdrop(page, ctx) {
        // Baseline rhythm grid — the compositional skeleton, barely visible.
        var step = 14.52; // 11pt × 1.32 leading
        ctx.save();
        ctx.strokeColor(INK).lineWidth(0.2).dash(0.8, { space: 5 }).opacity(0.045);
        for (var y = 40; y < page.height - 38; y += step) {
            ctx.moveTo(36, y)
                .lineTo(page.width - 36, y)
                .stroke();
        }
        ctx.undash();
        ctx.restore();
    },

    overlay(page, ctx) {
        var boxes = Array.isArray(page.boxes) ? page.boxes : [];
        if (!boxes.length) return;

        // Detect live left margin from box x positions.
        var lm = page.width;
        for (var i = 0; i < boxes.length; i++) {
            if (boxes[i].x > 0 && boxes[i].x < lm) lm = boxes[i].x;
        }
        // rm = right content edge (symmetric margin assumed).
        var rm = page.width - lm;

        // Rule right-extension: kept conservative so labels clear the page edge.
        // At rm ≈ 670 (50pt margins, 720pt wide page), rm + 8 = 678.
        // Label starts at 678 + 5 = 683; "CAP HEIGHT" (≈27pt) ends at 710.
        // That leaves ~10pt to the page edge — safe on any standard output.
        var RX = 8; // pt to extend rule past rm

        // ═══════════════════════════════════════════════════════════
        //  PAGE 1 — Measured, Not Guessed
        // ═══════════════════════════════════════════════════════════
        if (page.index === 0) {
            var titleBox = null;
            var dropCapBox = null;
            var manifestoBox = null;
            var polyBox = null;
            for (var i = 0; i < boxes.length; i++) {
                var b = boxes[i];
                if (b.type === 'title') titleBox = b;
                if (b.type === 'dropcap') dropCapBox = b;
                if (b.type === 'manifesto') manifestoBox = b;
                if (b.type === 'polyglotLead') polyBox = b;
            }

            // ── P1.0  Title baseline — ghost reference ───────────────
            if (titleBox) {
                var tm = getMetricsLine(titleBox, 0);
                if (tm) {
                    ctx.save();
                    ctx.strokeColor(INK).lineWidth(0.22).opacity(0.07);
                    ctx.moveTo(lm - 10, tm.baseline)
                        .lineTo(rm + 10, tm.baseline)
                        .stroke();
                    ctx.restore();
                }
            }

            // ── P1.1  Drop cap anatomy ───────────────────────────────
            // Cap height and baseline read from live font metrics — the core claim
            // of the engine. Annotations show what "measured" actually means.
            if (dropCapBox) {
                var dm = getMetricsLine(dropCapBox, 0);
                var dcX = dropCapBox.x;
                var dcY = dropCapBox.y;
                var dcW = dropCapBox.w;
                var dcH = dropCapBox.h;

                if (dm) {
                    var capTop = dm.baseline - dm.ascent;
                    var capBase = dm.baseline;
                    var arrowX = lm - 20;

                    // Full-width metric rules.
                    metricRule(ctx, capTop, lm - RX, rm + RX, 'CAP HEIGHT', 0.55);
                    metricRule(ctx, capBase, lm - RX, rm + RX, 'BASELINE', 0.6);

                    // Left-margin vertical dimension arrow.
                    vDim(ctx, arrowX, capTop, capBase, dm.ascent.toFixed(1) + ' pt');

                    // Badge ① — at the cap-height rule on the left edge of the "P".
                    badge(ctx, dcX, capTop, 1);

                    // Badge ② — at the baseline rule on the left edge of the "P".
                    badge(ctx, dcX, capBase, 2);

                    // Dashed bounding box around the drop cap glyph.
                    ctx.save();
                    ctx.strokeColor(INK).lineWidth(0.3).dash(1.8, { space: 2.4 }).opacity(0.2);
                    ctx.rect(dcX, dcY, dcW, dcH).stroke();
                    ctx.undash();
                    ctx.restore();
                }
            }

            // ── P1.2  Body text ascender reference ──────────────────
            // A secondary dashed rule at Arimo's ascender height shows that body
            // and display metrics are tracked independently — not derived from one
            // another.
            if (manifestoBox) {
                var mm = getMetricsLine(manifestoBox, 0);
                if (mm) {
                    var bodyAscY = mm.baseline - mm.ascent;
                    ctx.save();
                    ctx.strokeColor(INK).lineWidth(0.24).dash(1.5, { space: 3 }).opacity(0.24);
                    ctx.moveTo(lm, bodyAscY).lineTo(rm, bodyAscY).stroke();
                    ctx.undash();
                    ctx.restore();
                    lbl(ctx, rm + LABEL_GAP, bodyAscY - 4, 'ASCENDER', 4.8, 0.4);
                }
            }

            // ── P1.3  Polyglot lead badge ────────────────────────────
            if (polyBox) {
                var pm = getMetricsLine(polyBox, 0);
                var pbY = pm ? pm.baseline - pm.ascent * 0.5 : polyBox.y + safeN(polyBox.h, 14) * 0.5;

                badge(ctx, polyBox.x, pbY, 3);

                // Amber underline at the shared baseline — one rule, four scripts.
                if (pm) {
                    ctx.save();
                    ctx.strokeColor(ACCENT).lineWidth(0.35).opacity(0.38);
                    ctx.moveTo(polyBox.x, pm.baseline)
                        .lineTo(polyBox.x + polyBox.w, pm.baseline)
                        .stroke();
                    ctx.restore();
                }
            }
        }

        // ═══════════════════════════════════════════════════════════
        //  PAGE 2 — The Polyglot Contract
        // ═══════════════════════════════════════════════════════════
        if (page.index === 1) {
            var cjkBox = null;
            var arabicBox = null;
            var thesisBox = null;
            for (var i = 0; i < boxes.length; i++) {
                var b = boxes[i];
                if (b.type === 'cjkManifesto') cjkBox = b;
                if (b.type === 'arabicRibbon') arabicBox = b;
                if (b.type === 'thesis') thesisBox = b;
            }

            // ── P2.1  CJK block ──────────────────────────────────────
            if (cjkBox) {
                metricRule(ctx, cjkBox.y, lm - RX, rm + RX, 'CJK', 0.45);
                badge(ctx, lm, cjkBox.y, 4);

                // Bottom rule shows the block leading.
                var cjkBottom = cjkBox.y + safeN(cjkBox.h, 20);
                ctx.save();
                ctx.strokeColor(INK).lineWidth(0.24).dash(1.5, { space: 3 }).opacity(0.2);
                ctx.moveTo(lm - RX, cjkBottom)
                    .lineTo(rm + RX, cjkBottom)
                    .stroke();
                ctx.undash();
                ctx.restore();

                if (cjkBox.h > 4) {
                    vDim(ctx, rm + 18, cjkBox.y, cjkBottom, safeN(cjkBox.h, 0).toFixed(1) + ' pt');
                }
            }

            // ── P2.2  Arabic block ───────────────────────────────────
            if (arabicBox) {
                // "ARABIC RTL" fits in right margin: 6+1+3 = 10 chars × ≈3pt = 30pt.
                metricRule(ctx, arabicBox.y, lm - RX, rm + RX, 'ARABIC RTL', 0.45);
                // Badge ⑤ on the RIGHT content edge — the RTL entry point.
                badge(ctx, rm, arabicBox.y, 5);

                // Leftward direction arrow in the right margin.
                var ay = arabicBox.y + safeN(arabicBox.h, 18) * 0.5;
                rtlArrow(ctx, rm + RX + 2, ay, 18);
                lbl(ctx, rm + RX + 22, ay - 4, 'RTL', 4.8, 0.52);
            }

            // ── P2.3  Thesis ─────────────────────────────────────────
            if (thesisBox) {
                var thy = thesisBox.y + safeN(thesisBox.h, 14) * 0.5;
                badge(ctx, thesisBox.x - 10, thy, 6);

                var tm3 = getMetricsLine(thesisBox, 0);
                if (tm3) {
                    ctx.save();
                    ctx.strokeColor(INK).lineWidth(0.28).opacity(0.18);
                    ctx.moveTo(thesisBox.x, tm3.baseline)
                        .lineTo(thesisBox.x + thesisBox.w * 0.72, tm3.baseline)
                        .stroke();
                    ctx.restore();
                }
            }

            // ── Annotation Key ───────────────────────────────────────
            // Numbered legend in the specimen-book tradition:
            // "1) X-height  2) Ascender  3) Cap height…"
            var legendW = 218;
            var legendH = 116;
            var legendY = page.height - 38 - legendH - 4;
            var legendX = rm - legendW;

            ctx.save();
            ctx.fillColor('#ede5d4').opacity(0.96);
            ctx.rect(legendX - 8, legendY - 6, legendW + 8, legendH + 6).fill();
            ctx.strokeColor(INK).lineWidth(0.32).opacity(0.18);
            ctx.rect(legendX - 8, legendY - 6, legendW + 8, legendH + 6).stroke();
            ctx.restore();

            ctx.save();
            ctx.font('Helvetica-Bold', 6.5).fillColor(INK).opacity(0.88);
            ctx.text('ANNOTATION KEY', legendX, legendY + 1, { lineBreak: false });
            ctx.restore();

            ctx.save();
            ctx.strokeColor(INK).lineWidth(0.28).opacity(0.2);
            ctx.moveTo(legendX, legendY + 13)
                .lineTo(legendX + legendW - 4, legendY + 13)
                .stroke();
            ctx.restore();

            var entries = [
                [1, 'Cap height — read from font file, not em-square'],
                [2, 'Baseline — compositional anchor of the drop cap'],
                [3, 'Polyglot run — 4 scripts, one shared baseline grid'],
                [4, 'CJK — inter-char spacing derived from metrics'],
                [5, 'Arabic — typeset RTL; direction reversed, baseline locked'],
                [6, 'Thesis — italic Tinos 13pt, baseline rule confirmed'],
            ];

            var rowH = 15;
            for (var j = 0; j < entries.length; j++) {
                var rowTop = legendY + 20 + j * rowH;
                var badgeCY = rowTop + 5;
                badge(ctx, legendX + 5, badgeCY, entries[j][0]);
                lbl(ctx, legendX + 15, rowTop + 0.5, entries[j][1], 5.5, 0.82);
            }
        }
    },
};
