/**
 * 11-story-image-floats.overlay.mjs
 *
 * Reveals the StoryPackager's SpatialMap — the per-line obstacle registry
 * that governs text wrap.  All marks are in the margins or at very low
 * opacity behind content so the actual layout remains readable.
 *
 *   Image frame        — dashed rect at the image boundary, color-coded by
 *                         wrap strategy:
 *                           amber   = story-absolute
 *                           teal    = float L/R · around
 *                           violet  = float C  · around
 *                           sky     = float    · top-bottom
 *                           rose    = float    · none  (no SpatialMap entry)
 *
 *   Exclusion zone     — semi-transparent fill showing the rectangle that
 *                         the SpatialMap registers as unavailable for text:
 *                         image bounds expanded by gap on each text-facing
 *                         side.  wrap=none gets NO exclusion zone, confirming
 *                         the image is invisible to the resolver.
 *
 *   Gap callout        — dimension arrow on each text-facing edge, labelled
 *                         with the configured gap value in pts.
 *
 *   Mode pill          — "float-R · around", "story-abs · around",
 *                         "float-C · top-btm", "float-R · none", etc.
 *                         Placed above the image frame.
 *
 *   Dimensions label   — "WxH" inside the image verifies the configured size.
 *
 *   Story coords       — "x:N y:N" label inside story-absolute images shows
 *                         the declared story-local anchor.
 *
 *   Clear-point rule   — thin dashed horizontal line at image.bottom + gap
 *                         (for around) or image.top – gap and image.bottom + gap
 *                         (for top-bottom) marking where text resumes full
 *                         column width.  Absent for wrap=none.
 *
 *   Per-line intervals — behind each text line affected by a float:
 *                           amber fill  = actual text interval (SpatialMap output)
 *                           rose fill   = space consumed by the exclusion zone
 *                         Full-width lines are not tinted.  Directly shows the
 *                         line-level SpatialMap query result.
 *
 *   Column guides      — faint vertical rules at LEFT_EDGE and RIGHT_EDGE
 *                         marking the SpatialMap coordinate domain.
 *
 *   Page header        — page-number label in the top gutter on pages 2+.
 *
 *   Legend             — compact key on page 1, bottom-right of content area.
 */

// ── Color palette keyed by image layout ─────────────────────────────────────
function imageColor(mode, align, wrap) {
    if (mode === 'story-absolute') return '#f59e0b';
    if (wrap === 'none') return '#ec4899';
    if (wrap === 'top-bottom') return '#0ea5e9';
    if (align === 'center') return '#8b5cf6';
    return '#0d9488'; // left / right around
}

// ── Compact mode label ────────────────────────────────────────────────────────
function modeLabel(mode, align, wrap) {
    const m = mode === 'story-absolute' ? 'story-abs' : `float-${(align ?? 'L')[0].toUpperCase()}`;
    const w = wrap === 'top-bottom' ? 'top-btm' : (wrap ?? 'around');
    return `${m} · ${w}`;
}

export default {
    overlay(page, ctx) {
        const boxes = page.boxes;

        const LEFT_EDGE = boxes.reduce((min, b) => (b.x > 0 && b.x < min ? b.x : min), page.width);
        const RIGHT_EDGE = page.width - LEFT_EDGE;

        // Infer usable y-range from boxes on this page
        const contentBoxes = boxes.filter((b) => b.y >= 0);
        const colTop = contentBoxes.length ? Math.min(...contentBoxes.map((b) => b.y)) : LEFT_EDGE;
        const colBot = contentBoxes.length ? Math.max(...contentBoxes.map((b) => b.y + b.h)) : page.height - LEFT_EDGE;

        // ── Column guides ─────────────────────────────────────────────────────────
        ctx.save();
        ctx.strokeColor('#94a3b8').lineWidth(0.3).dash(5, { space: 6 }).opacity(0.18);
        ctx.moveTo(LEFT_EDGE, colTop).lineTo(LEFT_EDGE, colBot).stroke();
        ctx.moveTo(RIGHT_EDGE, colTop).lineTo(RIGHT_EDGE, colBot).stroke();
        ctx.undash();
        ctx.restore();

        // ── Legend (page 1 only) ──────────────────────────────────────────────────
        if (page.index === 0) {
            const ROW_H = 9;
            const ROWS = 6;
            const lw = 158;
            const lh = ROWS * ROW_H + 16;
            const lx = RIGHT_EDGE - lw;
            const ly = page.height - LEFT_EDGE - lh;

            ctx.save();
            ctx.fillColor('#f8fafc').opacity(0.95);
            ctx.rect(lx, ly, lw, lh).fill();
            ctx.strokeColor('#94a3b8').lineWidth(0.5).opacity(0.6);
            ctx.rect(lx, ly, lw, lh).stroke();
            ctx.restore();

            ctx.save();
            ctx.fillColor('#374151').opacity(0.9);
            ctx.font('Helvetica', 6.5);
            ctx.text('Overlay key', lx + 4, ly + 3, { lineBreak: false });
            ctx.restore();

            ctx.save();
            ctx.strokeColor('#cbd5e1').lineWidth(0.4).opacity(0.8);
            ctx.moveTo(lx, ly + 12)
                .lineTo(lx + lw, ly + 12)
                .stroke();
            ctx.restore();

            const ICON_X = lx + 4;
            const DESC_X = lx + 28;
            const lt = (str, x, y, color, op = 0.85) => {
                ctx.save();
                ctx.fillColor(color).opacity(op);
                ctx.font('Helvetica', 5.5);
                ctx.text(str, x, y, { lineBreak: false });
                ctx.restore();
            };
            const row = (i) => ({ iconY: ly + 16 + i * ROW_H + ROW_H / 2, descY: ly + 16 + i * ROW_H + 1 });

            // Row 0 — image frame colors
            {
                const { iconY, descY } = row(0);
                [
                    ['#f59e0b', 0],
                    ['#0d9488', 8],
                    ['#8b5cf6', 16],
                    ['#0ea5e9', 24],
                    ['#ec4899', 32],
                ].forEach(([c, dx]) => {
                    ctx.save();
                    ctx.strokeColor(c).lineWidth(0.7).dash(3, { space: 2 }).opacity(0.8);
                    ctx.rect(ICON_X + dx, iconY - 4, 6, 7).stroke();
                    ctx.undash();
                    ctx.restore();
                });
                lt('story-abs / around / center / top-btm / none', DESC_X, descY, '#374151');
            }

            // Row 1 — exclusion zone
            {
                const { iconY, descY } = row(1);
                ctx.save();
                ctx.fillColor('#0d9488').opacity(0.14);
                ctx.rect(ICON_X, iconY - 4, 20, 8).fill();
                ctx.restore();
                ctx.save();
                ctx.strokeColor('#0d9488').lineWidth(0.7).dash(3, { space: 2 }).opacity(0.8);
                ctx.rect(ICON_X + 2, iconY - 2, 14, 4).stroke();
                ctx.undash();
                ctx.restore();
                lt('SpatialMap exclusion zone (image + gap)', DESC_X, descY, '#374151');
            }

            // Row 2 — gap callout
            {
                const { iconY, descY } = row(2);
                ctx.save();
                ctx.strokeColor('#0d9488').lineWidth(0.5).opacity(0.65);
                ctx.moveTo(ICON_X, iconY)
                    .lineTo(ICON_X + 12, iconY)
                    .stroke();
                ctx.moveTo(ICON_X, iconY - 2)
                    .lineTo(ICON_X, iconY + 2)
                    .stroke();
                ctx.moveTo(ICON_X + 12, iconY - 2)
                    .lineTo(ICON_X + 12, iconY + 2)
                    .stroke();
                ctx.restore();
                lt('8pt gap', ICON_X + 14, descY, '#0d9488');
                lt('gap between image and text', DESC_X, descY, '#374151');
            }

            // Row 3 — per-line interval tints
            {
                const { iconY, descY } = row(3);
                ctx.save();
                ctx.fillColor('#f59e0b').opacity(0.35);
                ctx.rect(ICON_X, iconY - 3, 12, 6).fill();
                ctx.restore();
                ctx.save();
                ctx.fillColor('#ec4899').opacity(0.25);
                ctx.rect(ICON_X + 12, iconY - 3, 8, 6).fill();
                ctx.restore();
                lt('text interval (amber) / eaten space (rose)', DESC_X, descY, '#374151');
            }

            // Row 4 — clear-point rule
            {
                const { iconY, descY } = row(4);
                ctx.save();
                ctx.strokeColor('#0d9488').lineWidth(0.5).dash(3, { space: 3 }).opacity(0.6);
                ctx.moveTo(ICON_X, iconY)
                    .lineTo(ICON_X + 20, iconY)
                    .stroke();
                ctx.undash();
                ctx.restore();
                lt('clear point — full column width restored', DESC_X, descY, '#374151');
            }

            // Row 5 — mode pill
            {
                const { iconY, descY } = row(5);
                ctx.save();
                ctx.fillColor('#0d9488').opacity(0.8);
                ctx.roundedRect(ICON_X, iconY - 4, 22, 8, 2).fill();
                ctx.restore();
                ctx.save();
                ctx.fillColor('#ffffff').opacity(1);
                ctx.font('Helvetica', 4.5);
                ctx.text('float-R', ICON_X + 2, iconY - 2, { lineBreak: false });
                ctx.restore();
                lt('layout mode · wrap strategy', DESC_X, descY, '#374151');
            }

            // Optical underhang note
            ctx.save();
            ctx.fillColor('#6366f1').opacity(0.7);
            ctx.font('Helvetica', 5.5);
            ctx.text('opticalUnderhang: on', lx + 4, ly + lh + 5, { lineBreak: false });
            ctx.restore();
        }

        // ── Page header (pages 2+) ────────────────────────────────────────────────
        if (page.index > 0) {
            const gm = LEFT_EDGE / 2;
            ctx.save();
            ctx.strokeColor('#cbd5e1').lineWidth(0.4).opacity(0.7);
            ctx.moveTo(LEFT_EDGE, gm + 4)
                .lineTo(RIGHT_EDGE, gm + 4)
                .stroke();
            ctx.fillColor('#94a3b8').opacity(0.7);
            ctx.font('Helvetica', 6);
            ctx.text(`page ${page.index + 1}`, LEFT_EDGE, gm, { lineBreak: false });
            ctx.restore();
        }

        // ── Per-box annotations ───────────────────────────────────────────────────
        boxes.forEach((box) => {
            // ── Image boxes ─────────────────────────────────────────────────────────
            if (box.type === 'image') {
                const layout = box.properties?.layout ?? {};
                const mode = String(layout.mode ?? 'float');
                const align = String(layout.align ?? 'left');
                const wrap = String(layout.wrap ?? 'around');
                const gap = Number(layout.gap ?? 0);
                const storyX = layout.x != null ? Number(layout.x) : null;
                const storyY = layout.y != null ? Number(layout.y) : null;
                const color = imageColor(mode, align, wrap);
                const isStoryAbs = mode === 'story-absolute';
                const storyColMid = (LEFT_EDGE + RIGHT_EDGE) / 2;

                // Determine text-facing side(s) for gap annotation
                // For story-absolute: infer from image position
                const isRightHalf = box.x + box.w / 2 > storyColMid;
                const gapLeft =
                    wrap === 'around' && (align === 'right' || align === 'center' || (isStoryAbs && isRightHalf));
                const gapRight =
                    wrap === 'around' && (align === 'left' || align === 'center' || (isStoryAbs && !isRightHalf));
                const gapTop = wrap === 'top-bottom';
                const gapBot = wrap === 'top-bottom';

                // ── Exclusion zone (SpatialMap registered rect) ──────────────────────
                if (wrap !== 'none') {
                    let ezX = box.x,
                        ezY = box.y,
                        ezW = box.w,
                        ezH = box.h;
                    if (gapLeft) {
                        ezX -= gap;
                        ezW += gap;
                    }
                    if (gapRight) {
                        ezW += gap;
                    }
                    if (gapTop) {
                        ezY -= gap;
                        ezH += gap;
                    }
                    if (gapBot) {
                        ezH += gap;
                    }
                    ctx.save();
                    ctx.fillColor(color).opacity(0.09);
                    ctx.rect(ezX, ezY, ezW, ezH).fill();
                    ctx.restore();
                }

                // ── Image frame (dashed rect) ─────────────────────────────────────────
                ctx.save();
                ctx.strokeColor(color).lineWidth(0.7).dash(3, { space: 2 }).opacity(0.85);
                ctx.rect(box.x, box.y, box.w, box.h).stroke();
                ctx.undash();
                ctx.restore();

                // ── Gap callouts ──────────────────────────────────────────────────────
                const drawGapArrow = (x1, y1, x2, y2, labelStr, labelSide) => {
                    ctx.save();
                    ctx.strokeColor(color).lineWidth(0.5).opacity(0.65);
                    ctx.moveTo(x1, y1).lineTo(x2, y2).stroke();
                    // end ticks (perpendicular)
                    const isH = y1 === y2;
                    if (isH) {
                        ctx.moveTo(x1, y1 - 2)
                            .lineTo(x1, y1 + 2)
                            .stroke();
                        ctx.moveTo(x2, y2 - 2)
                            .lineTo(x2, y2 + 2)
                            .stroke();
                    } else {
                        ctx.moveTo(x1 - 2, y1)
                            .lineTo(x1 + 2, y1)
                            .stroke();
                        ctx.moveTo(x2 - 2, y2)
                            .lineTo(x2 + 2, y2)
                            .stroke();
                    }
                    ctx.restore();
                    const lx2 = isH ? (labelSide === 'left' ? x1 - 14 : x2 + 2) : x2 + 3;
                    const ly2 = isH ? y1 - 3 : (y1 + y2) / 2 - 3;
                    ctx.save();
                    ctx.fillColor(color).opacity(0.75);
                    ctx.font('Helvetica', 5);
                    ctx.text(labelStr, lx2, ly2, { lineBreak: false });
                    ctx.restore();
                };

                if (gap > 0) {
                    const gapStr = `${gap}pt`;
                    const midY = box.y + box.h * 0.4;
                    const midX = box.x + box.w / 2;
                    if (gapLeft) drawGapArrow(box.x - gap, midY, box.x, midY, gapStr, 'left');
                    if (gapRight)
                        drawGapArrow(box.x + box.w, midY * 1.1, box.x + box.w + gap, midY * 1.1, gapStr, 'right');
                    if (gapTop) drawGapArrow(midX, box.y - gap, midX, box.y, gapStr, 'right');
                    if (gapBot) drawGapArrow(midX, box.y + box.h, midX, box.y + box.h + gap, gapStr, 'right');
                }

                // ── Clear-point rule(s) ───────────────────────────────────────────────
                if (wrap === 'around') {
                    const clearY = box.y + box.h + gap;
                    ctx.save();
                    ctx.strokeColor(color).lineWidth(0.5).dash(4, { space: 3 }).opacity(0.5);
                    ctx.moveTo(LEFT_EDGE, clearY).lineTo(RIGHT_EDGE, clearY).stroke();
                    ctx.undash();
                    ctx.restore();
                    ctx.save();
                    ctx.fillColor(color).opacity(0.6);
                    ctx.font('Helvetica', 5);
                    ctx.text('clear', LEFT_EDGE + 2, clearY - 6, { lineBreak: false });
                    ctx.restore();
                } else if (wrap === 'top-bottom') {
                    [box.y - gap, box.y + box.h + gap].forEach((clearY) => {
                        ctx.save();
                        ctx.strokeColor(color).lineWidth(0.5).dash(4, { space: 3 }).opacity(0.5);
                        ctx.moveTo(LEFT_EDGE, clearY).lineTo(RIGHT_EDGE, clearY).stroke();
                        ctx.undash();
                        ctx.restore();
                    });
                }

                // ── Mode pill (above image, right-aligned) ────────────────────────────
                const label = modeLabel(mode, align, wrap);
                const pw = Math.ceil(label.length * 3.5 + 10);
                const ph = 10;
                const px = Math.min(box.x + box.w, RIGHT_EDGE) - pw;
                const py = box.y - ph - 2;
                // Fallback: inside image top-right if no room above
                const pySafe = py >= LEFT_EDGE / 2 ? py : box.y + 2;
                ctx.save();
                ctx.fillColor(color).opacity(0.85);
                ctx.roundedRect(px, pySafe, pw, ph, 2).fill();
                ctx.fillColor('#ffffff').opacity(1);
                ctx.font('Helvetica', 5.5);
                ctx.text(label, px + 4, pySafe + 2, { lineBreak: false });
                ctx.restore();

                // ── Dimensions label inside image ─────────────────────────────────────
                ctx.save();
                ctx.fillColor('#ffffff').opacity(0.8);
                ctx.font('Helvetica', 5);
                ctx.text(`${Math.round(box.w)}\xd7${Math.round(box.h)}`, box.x + 3, box.y + 3, { lineBreak: false });
                ctx.restore();

                // ── Story-local coordinates for story-absolute images ─────────────────
                if (isStoryAbs && storyX != null && storyY != null) {
                    ctx.save();
                    ctx.fillColor('#ffffff').opacity(0.75);
                    ctx.font('Helvetica', 5);
                    ctx.text(`x:${storyX} y:${storyY}`, box.x + 3, box.y + box.h - 8, { lineBreak: false });
                    ctx.restore();
                }

                // ── "no-wrap" mark for wrap=none ──────────────────────────────────────
                if (wrap === 'none') {
                    // Diagonal cross to show "not in SpatialMap"
                    ctx.save();
                    ctx.strokeColor(color).lineWidth(0.5).opacity(0.35);
                    ctx.moveTo(box.x, box.y)
                        .lineTo(box.x + box.w, box.y + box.h)
                        .stroke();
                    ctx.moveTo(box.x + box.w, box.y)
                        .lineTo(box.x, box.y + box.h)
                        .stroke();
                    ctx.restore();
                }

                // ── Text / content boxes: per-line interval tints ───────────────────────
            } else {
                const metrics = box.properties?.__vmprintTextMetrics;
                if (!metrics?.lines || !box.lines?.length) return;

                const contentX = metrics.contentBox.x;
                const contentW = metrics.contentBox.w;
                const storyWidth = RIGHT_EDGE - LEFT_EDGE;

                // Only annotate lines that are meaningfully narrower than their box
                metrics.lines.forEach((lineMeta, li) => {
                    const segs = box.lines[li];
                    if (!segs) return;
                    const lineTextWidth = segs.reduce((sum, s) => sum + (s.width || 0), 0);
                    if (lineTextWidth <= 0) return;

                    // Threshold: line must be at least 8% shorter than the available box width
                    const available = contentW > 0 ? contentW : box.w;
                    if (lineTextWidth >= available * 0.92) return;

                    const { top: lineTop, height: lineH } = lineMeta;

                    // Amber: the text interval the resolver assigned
                    ctx.save();
                    ctx.fillColor('#f59e0b').opacity(0.08);
                    ctx.rect(contentX, lineTop, lineTextWidth, lineH).fill();
                    ctx.restore();

                    // Rose: the eaten space (exclusion zone encroachment)
                    ctx.save();
                    ctx.fillColor('#ec4899').opacity(0.06);
                    ctx.rect(contentX + lineTextWidth, lineTop, available - lineTextWidth, lineH).fill();
                    ctx.restore();
                });
            }
        });
    },
};
