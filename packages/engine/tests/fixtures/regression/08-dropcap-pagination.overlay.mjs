/**
 * 08-dropcap-pagination.overlay.mjs
 *
 * All annotations live in the page margins — never overlapping content.
 *
 *   • Drop-cap boundary rules  — amber dashed rules at cap top/bottom,
 *       solid left bracket along the cap left edge.
 *   • Drop-cap pill            — amber "dropcap" label at top-right of cap box.
 *   • Cap-height dimension     — vertical callout in left gutter (pts).
 *   • Body baseline grid       — amber dotted lines at each body-text baseline
 *       within the cap zone (drawn across the cap box width only); verifies
 *       that the cap spans exactly N body lines.
 *   • Gap callout              — horizontal dimension arrow between cap right
 *       edge and body-text left edge; verifies the gap config value.
 *   • Exclusion-zone border    — thin slate dashed vertical line at body-text
 *       left edge for the full cap height (shows the wrap boundary).
 *   • Fragment seam + badge    — teal dashed seam at the top of every
 *       continuation box, navy "F{n}" pill in the left margin.
 *   • Line-count labels        — "NL" in the right margin:
 *       indigo = first-fragment side, teal = continuation side.
 *   • Split-marker pip         — small amber dot in the left margin.
 *   • Overflow-policy badge    — violet pill in the right margin when the
 *       box carries an overflowPolicy value.
 *   • Legend                   — compact key on page 1, bottom-right.
 */
export default {
    overlay(page, ctx) {
        const boxes = page.boxes;

        // Infer content edges from leftmost box
        const LEFT_EDGE = boxes.reduce((min, b) => (b.x > 0 && b.x < min ? b.x : min), page.width);
        const RIGHT_EDGE = page.width - LEFT_EDGE;

        // ── Pre-pass: split-marker detection ─────────────────────────────────────
        const firstFragIdx = new Set();
        boxes.forEach((box, i) => {
            if (box.type === 'split-marker' && i > 0) firstFragIdx.add(i - 1);
        });

        // ── Pre-pass: pair each dropcap box with its companion body box ───────────
        // The companion is the nearest following non-dropcap, non-split-marker box.
        const dropcapCompanion = new Map(); // box-index → companion body box
        boxes.forEach((box, i) => {
            if (box.type === 'dropcap') {
                for (let j = i + 1; j < Math.min(i + 5, boxes.length); j++) {
                    const b = boxes[j];
                    if (b.type !== 'dropcap' && b.type !== 'split-marker') {
                        dropcapCompanion.set(i, b);
                        break;
                    }
                }
            }
        });

        // ── Legend (page 1 only) ──────────────────────────────────────────────────
        if (page.index === 0) {
            const ROW_H = 9;
            const ROWS = 7;
            const lw = 148;
            const lh = ROWS * ROW_H + 16;
            const lx = RIGHT_EDGE - lw;
            const ly = page.height - LEFT_EDGE - lh;

            // Background + border
            ctx.save();
            ctx.fillColor('#f8fafc').opacity(0.95);
            ctx.rect(lx, ly, lw, lh).fill();
            ctx.strokeColor('#94a3b8').lineWidth(0.5).opacity(0.6);
            ctx.rect(lx, ly, lw, lh).stroke();
            ctx.restore();

            // Title
            ctx.save();
            ctx.fillColor('#374151').opacity(0.9);
            ctx.font('Helvetica', 6.5);
            ctx.text('Overlay key', lx + 4, ly + 3, { lineBreak: false });
            ctx.restore();

            // Divider
            ctx.save();
            ctx.strokeColor('#cbd5e1').lineWidth(0.4).opacity(0.8);
            ctx.moveTo(lx, ly + 12)
                .lineTo(lx + lw, ly + 12)
                .stroke();
            ctx.restore();

            const ICON_X = lx + 4;
            const DESC_X = lx + 26;

            const legendText = (str, x, y, color, opacity = 0.85) => {
                ctx.save();
                ctx.fillColor(color).opacity(opacity);
                ctx.font('Helvetica', 5.5);
                ctx.text(str, x, y, { lineBreak: false });
                ctx.restore();
            };

            const row = (i) => ({
                iconY: ly + 16 + i * ROW_H + ROW_H / 2,
                descY: ly + 16 + i * ROW_H + 1,
            });

            // Row 0 — Cap boundary rule
            {
                const { iconY, descY } = row(0);
                ctx.save();
                ctx.strokeColor('#f59e0b').lineWidth(0.6).dash(4, { space: 3 }).opacity(0.7);
                ctx.moveTo(ICON_X, iconY)
                    .lineTo(ICON_X + 18, iconY)
                    .stroke();
                ctx.undash();
                ctx.restore();
                legendText('cap top / bottom boundary', DESC_X, descY, '#374151');
            }

            // Row 1 — Baseline grid
            {
                const { iconY, descY } = row(1);
                ctx.save();
                ctx.strokeColor('#f59e0b').lineWidth(0.4).dash(2, { space: 3 }).opacity(0.55);
                ctx.moveTo(ICON_X, iconY)
                    .lineTo(ICON_X + 18, iconY)
                    .stroke();
                ctx.undash();
                ctx.restore();
                legendText('body baseline within cap zone', DESC_X, descY, '#374151');
            }

            // Row 2 — Gap callout
            {
                const { iconY, descY } = row(2);
                ctx.save();
                ctx.strokeColor('#94a3b8').lineWidth(0.5).opacity(0.7);
                ctx.moveTo(ICON_X + 2, iconY)
                    .lineTo(ICON_X + 18, iconY)
                    .stroke();
                ctx.moveTo(ICON_X + 2, iconY - 2)
                    .lineTo(ICON_X + 2, iconY + 2)
                    .stroke();
                ctx.moveTo(ICON_X + 18, iconY - 2)
                    .lineTo(ICON_X + 18, iconY + 2)
                    .stroke();
                ctx.restore();
                legendText('cap-to-body gap width', DESC_X, descY, '#374151');
            }

            // Row 3 — Dropcap pill
            {
                const { iconY, descY } = row(3);
                ctx.save();
                ctx.fillColor('#f59e0b').opacity(0.85);
                ctx.roundedRect(ICON_X, iconY - 4, 20, 8, 2).fill();
                ctx.fillColor('#ffffff').opacity(1);
                ctx.font('Helvetica', 5.5);
                ctx.text('drop', ICON_X + 2, iconY - 2.5, { lineBreak: false });
                ctx.restore();
                legendText('drop cap identified', DESC_X, descY, '#374151');
            }

            // Row 4 — Fragment badge
            {
                const { iconY, descY } = row(4);
                ctx.save();
                ctx.fillColor('#0f4c81').opacity(0.85);
                ctx.roundedRect(ICON_X, iconY - 5, 14, 9, 2).fill();
                ctx.fillColor('#ffffff').opacity(1);
                ctx.font('Helvetica', 5.5);
                ctx.text('F1', ICON_X + 3, iconY - 3.5, { lineBreak: false });
                ctx.restore();
                legendText('continuation fragment badge', DESC_X, descY, '#374151');
            }

            // Row 5 — Seam line
            {
                const { iconY, descY } = row(5);
                ctx.save();
                ctx.strokeColor('#0d9488').lineWidth(0.9).dash(3, { space: 2 }).opacity(0.8);
                ctx.moveTo(ICON_X, iconY)
                    .lineTo(ICON_X + 18, iconY)
                    .stroke();
                ctx.undash();
                ctx.restore();
                legendText('split seam (join point)', DESC_X, descY, '#374151');
            }

            // Row 6 — Overflow-policy badge
            {
                const { iconY, descY } = row(6);
                ctx.save();
                ctx.fillColor('#8b5cf6').opacity(0.75);
                ctx.roundedRect(ICON_X, iconY - 4, 22, 8, 2).fill();
                ctx.fillColor('#ffffff').opacity(1);
                ctx.font('Helvetica', 5);
                ctx.text('policy', ICON_X + 2, iconY - 2.5, { lineBreak: false });
                ctx.restore();
                legendText('overflow policy (e.g. move-whole)', DESC_X, descY, '#374151');
            }
        }

        // ── Page header (pages 2+) ─────────────────────────────────────────────────
        if (page.index > 0) {
            const gutterMid = LEFT_EDGE / 2;
            ctx.save();
            ctx.strokeColor('#cbd5e1').lineWidth(0.4).opacity(0.7);
            ctx.moveTo(LEFT_EDGE, gutterMid + 4)
                .lineTo(RIGHT_EDGE, gutterMid + 4)
                .stroke();
            ctx.fillColor('#94a3b8').opacity(0.7);
            ctx.font('Helvetica', 6);
            ctx.text(`page ${page.index + 1}`, LEFT_EDGE, gutterMid, { lineBreak: false });
            ctx.restore();
        }

        // ── Per-box annotations ───────────────────────────────────────────────────
        boxes.forEach((box, bi) => {
            const isContinuation = box.meta?.isContinuation === true;
            const fragIndex = Number(box.meta?.fragmentIndex ?? 0);
            const isSplitMarker = box.type === 'split-marker';
            const isDropcap = box.type === 'dropcap';
            const lineCount = box.lines?.length ?? 0;
            const isFirstFrag = firstFragIdx.has(bi);
            const isCont = !isSplitMarker && !isDropcap && (isContinuation || fragIndex > 0);
            const overflowPolicy = box.style?.overflowPolicy;

            // ── Drop-cap geometry annotations ───────────────────────────────────────
            if (isDropcap) {
                // Amber dashed boundary rules spanning to RIGHT_EDGE
                ctx.save();
                ctx.strokeColor('#f59e0b').lineWidth(0.6).dash(4, { space: 3 }).opacity(0.7);
                ctx.moveTo(box.x, box.y).lineTo(RIGHT_EDGE, box.y).stroke();
                ctx.moveTo(box.x, box.y + box.h)
                    .lineTo(RIGHT_EDGE, box.y + box.h)
                    .stroke();
                ctx.undash();
                // Left vertical bracket along the cap's left edge
                ctx.lineWidth(1).opacity(0.5);
                ctx.moveTo(box.x, box.y)
                    .lineTo(box.x, box.y + box.h)
                    .stroke();
                ctx.restore();

                // Amber "dropcap" pill — top-right of cap box
                const pw = 40,
                    ph = 10;
                ctx.save();
                ctx.fillColor('#f59e0b').opacity(0.85);
                ctx.roundedRect(box.x + box.w + 2, box.y, pw, ph, 2).fill();
                ctx.fillColor('#ffffff').opacity(1);
                ctx.font('Helvetica', 6);
                ctx.text('dropcap', box.x + box.w + 4, box.y + 2, { lineBreak: false });
                ctx.restore();

                // Cap-height dimension callout in the left gutter
                const dimX = LEFT_EDGE - 10;
                ctx.save();
                ctx.strokeColor('#f59e0b').lineWidth(0.5).opacity(0.55);
                ctx.moveTo(dimX, box.y)
                    .lineTo(dimX, box.y + box.h)
                    .stroke();
                ctx.moveTo(dimX - 3, box.y)
                    .lineTo(dimX + 3, box.y)
                    .stroke();
                ctx.moveTo(dimX - 3, box.y + box.h)
                    .lineTo(dimX + 3, box.y + box.h)
                    .stroke();
                ctx.restore();
                ctx.save();
                ctx.fillColor('#f59e0b').opacity(0.75);
                ctx.font('Helvetica', 5);
                ctx.text(`${Math.round(box.h)}pt`, LEFT_EDGE - 28, box.y + box.h / 2 - 2, { lineBreak: false });
                ctx.restore();

                // Companion body box annotations (gap + exclusion border + baseline grid)
                const companion = dropcapCompanion.get(bi);
                if (companion) {
                    const gapStart = box.x + box.w;
                    const gapEnd = companion.x;
                    const gap = gapEnd - gapStart;

                    // Gap callout arrow
                    if (gap > 1) {
                        const arrowY = box.y + 4;
                        ctx.save();
                        ctx.strokeColor('#94a3b8').lineWidth(0.5).opacity(0.7);
                        ctx.moveTo(gapStart, arrowY).lineTo(gapEnd, arrowY).stroke();
                        ctx.moveTo(gapStart, arrowY - 2)
                            .lineTo(gapStart, arrowY + 2)
                            .stroke();
                        ctx.moveTo(gapEnd, arrowY - 2)
                            .lineTo(gapEnd, arrowY + 2)
                            .stroke();
                        ctx.restore();
                        ctx.save();
                        ctx.fillColor('#64748b').opacity(0.8);
                        ctx.font('Helvetica', 5);
                        ctx.text(`${Math.round(gap)}pt`, (gapStart + gapEnd) / 2 - 5, arrowY - 7, { lineBreak: false });
                        ctx.restore();
                    }

                    // Exclusion-zone right-edge — dashed vertical line at body left edge
                    ctx.save();
                    ctx.strokeColor('#94a3b8').lineWidth(0.4).dash(2, { space: 2 }).opacity(0.4);
                    ctx.moveTo(companion.x, box.y)
                        .lineTo(companion.x, box.y + box.h)
                        .stroke();
                    ctx.undash();
                    ctx.restore();

                    // Body baseline grid within the cap zone
                    const metrics = companion.properties?.__vmprintTextMetrics;
                    if (metrics?.lines) {
                        metrics.lines.forEach((lineMeta) => {
                            const bl = lineMeta.baseline;
                            if (bl >= box.y - 1 && bl <= box.y + box.h + 1) {
                                ctx.save();
                                ctx.strokeColor('#f59e0b').lineWidth(0.4).dash(2, { space: 3 }).opacity(0.45);
                                ctx.moveTo(box.x, bl)
                                    .lineTo(box.x + box.w, bl)
                                    .stroke();
                                ctx.undash();
                                ctx.restore();
                            }
                        });
                    }
                }
            }

            // ── Fragment seam + badge ───────────────────────────────────────────────
            if (isCont) {
                ctx.save();
                ctx.strokeColor('#0d9488').lineWidth(0.9).dash(3, { space: 2 }).opacity(0.8);
                ctx.moveTo(box.x, box.y)
                    .lineTo(box.x + box.w, box.y)
                    .stroke();
                ctx.undash();
                ctx.restore();

                const bw = 20,
                    bh = 11;
                const bx = LEFT_EDGE - bw - 3;
                const by = box.y;
                ctx.save();
                ctx.fillColor('#0f4c81').opacity(0.85);
                ctx.roundedRect(bx, by, bw, bh, 2).fill();
                ctx.fillColor('#ffffff').opacity(1);
                ctx.font('Helvetica', 6.5);
                ctx.text(`F${fragIndex}`, bx + 4, by + 2, { lineBreak: false });
                ctx.restore();
            }

            // ── Line-count labels in the right margin ───────────────────────────────
            if (lineCount > 0 && (isFirstFrag || isCont)) {
                const color = isCont ? '#0d9488' : '#6366f1';
                ctx.save();
                ctx.fillColor(color).opacity(0.85);
                ctx.font('Helvetica', 6.5);
                ctx.text(`${lineCount}L`, RIGHT_EDGE + 4, box.y + 2, { lineBreak: false });
                ctx.restore();
            }

            // ── Split-marker pip ────────────────────────────────────────────────────
            if (isSplitMarker) {
                ctx.save();
                ctx.fillColor('#f59e0b').opacity(0.85);
                ctx.roundedRect(LEFT_EDGE - 8, box.y + box.h / 2 - 3, 6, 6, 3).fill();
                ctx.restore();
            }

            // ── Overflow-policy badge in right margin ───────────────────────────────
            if (overflowPolicy) {
                const label = String(overflowPolicy);
                const pw = label.length * 4 + 8;
                const ph = 10;
                const px = RIGHT_EDGE + 4;
                const py = box.y + 14; // below any line-count label
                ctx.save();
                ctx.fillColor('#8b5cf6').opacity(0.75);
                ctx.roundedRect(px, py, pw, ph, 2).fill();
                ctx.fillColor('#ffffff').opacity(1);
                ctx.font('Helvetica', 5.5);
                ctx.text(label, px + 4, py + 2, { lineBreak: false });
                ctx.restore();
            }
        });
    },
};
