/**
 * 07-pagination-fragments.overlay.mjs
 *
 * All annotations live in the page margins — never overlapping content.
 *
 *   • Legend      — compact key drawn on page 1 (bottom-right of content area).
 *   • Page header — page-number label in the top gutter on pages 2+.
 *   • Fragment seam + badge
 *       – teal dashed rule at the top edge of every continuation box (the join seam)
 *       – navy "F{n}" pill in the left margin  [split-markers excluded]
 *   • Line-count label — "NL" in the right margin for both sides of a split:
 *       indigo = first-fragment side, teal = continuation side
 *       (makes orphan/widow counts readable without manual counting)
 *   • Split-marker pip — small amber dot in the left margin beside each
 *       engine-injected transition label
 *   • Keep-with-next chevron — downward "v" in the right margin
 *   • No-split bar + badge — rose bar and "NS" pill in the left margin
 *   • Blockquote content-inset rect — dashed blue rectangle at the content-box
 *       boundary (from __vmprintTextMetrics) to verify padding on each fragment
 */
export default {
    overlay(page, ctx) {
        const boxes = page.boxes;

        // Infer left-content edge from the leftmost box (robust to any margin setting).
        const LEFT_EDGE = boxes.reduce((min, b) => (b.x > 0 && b.x < min ? b.x : min), page.width);
        const RIGHT_EDGE = page.width - LEFT_EDGE;

        // ── Pre-pass: locate the boxes on either side of split-markers ───────────
        const firstFragIdx = new Set(); // box just BEFORE a split-marker
        const afterMarkerIdx = new Set(); // box just AFTER  a split-marker
        boxes.forEach((box, i) => {
            if (box.type === 'split-marker') {
                if (i > 0) firstFragIdx.add(i - 1);
                if (i < boxes.length - 1) afterMarkerIdx.add(i + 1);
            }
        });

        // ── Legend (page 1 only) ─────────────────────────────────────────────────
        if (page.index === 0) {
            const ROW_H = 9;
            const ROWS = 7;
            const lw = 130;
            const lh = ROWS * ROW_H + 16; // 16 = header + divider
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

            // Divider under title
            ctx.save();
            ctx.strokeColor('#cbd5e1').lineWidth(0.4).opacity(0.8);
            ctx.moveTo(lx, ly + 12)
                .lineTo(lx + lw, ly + 12)
                .stroke();
            ctx.restore();

            // Row renderer helpers
            const DESC_X = lx + 24;
            const ICON_X = lx + 4;

            const legendText = (str, x, y, color, opacity = 0.85) => {
                ctx.save();
                ctx.fillColor(color).opacity(opacity);
                ctx.font('Helvetica', 5.5);
                ctx.text(str, x, y, { lineBreak: false });
                ctx.restore();
            };

            const row = (i) => ({ iconY: ly + 16 + i * ROW_H + ROW_H / 2, descY: ly + 16 + i * ROW_H + 1 });

            // Row 0 — Fragment badge
            {
                const { iconY, descY } = row(0);
                ctx.save();
                ctx.fillColor('#0f4c81').opacity(0.85);
                ctx.roundedRect(ICON_X, iconY - 5, 14, 9, 2).fill();
                ctx.fillColor('#ffffff').opacity(1);
                ctx.font('Helvetica', 5.5);
                ctx.text('F1', ICON_X + 3, iconY - 3.5, { lineBreak: false });
                ctx.restore();
                legendText('continuation fragment badge', DESC_X, descY, '#374151');
            }

            // Row 1 — Seam line
            {
                const { iconY, descY } = row(1);
                ctx.save();
                ctx.strokeColor('#0d9488').lineWidth(0.9).dash(3, { space: 2 }).opacity(0.8);
                ctx.moveTo(ICON_X, iconY)
                    .lineTo(ICON_X + 16, iconY)
                    .stroke();
                ctx.undash();
                ctx.restore();
                legendText('split seam (join point)', DESC_X, descY, '#374151');
            }

            // Row 2 — Line count, cont. side
            {
                const { descY } = row(2);
                legendText('5L', ICON_X + 1, descY, '#0d9488');
                legendText('line count — cont. side', DESC_X, descY, '#374151');
            }

            // Row 3 — Line count, first-frag side
            {
                const { descY } = row(3);
                legendText('5L', ICON_X + 1, descY, '#6366f1');
                legendText('line count — first-frag side', DESC_X, descY, '#374151');
            }

            // Row 4 — Split-marker pip
            {
                const { iconY, descY } = row(4);
                ctx.save();
                ctx.fillColor('#f59e0b').opacity(0.85);
                ctx.roundedRect(ICON_X + 4, iconY - 3, 6, 6, 3).fill();
                ctx.restore();
                legendText('split-marker injected label', DESC_X, descY, '#374151');
            }

            // Row 5 — KWN chevron
            {
                const { iconY, descY } = row(5);
                ctx.save();
                ctx.strokeColor('#0f4c81').lineWidth(1.2).opacity(0.7);
                ctx.moveTo(ICON_X + 2, iconY - 3)
                    .lineTo(ICON_X + 7, iconY + 1)
                    .lineTo(ICON_X + 12, iconY - 3)
                    .stroke();
                ctx.restore();
                legendText('keep-with-next chain', DESC_X, descY, '#374151');
            }

            // Row 6 — No-split bar
            {
                const { iconY, descY } = row(6);
                ctx.save();
                ctx.strokeColor('#ec4899').lineWidth(2).opacity(0.55);
                ctx.moveTo(ICON_X + 7, iconY - 4)
                    .lineTo(ICON_X + 7, iconY + 3)
                    .stroke();
                ctx.restore();
                legendText('no-split constraint', DESC_X, descY, '#374151');
            }
        }

        // ── Page header (pages 2+) ────────────────────────────────────────────────
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

        // ── Per-box annotations ──────────────────────────────────────────────────
        boxes.forEach((box, bi) => {
            const fragIndex = Number(box.meta?.fragmentIndex ?? 0);
            const isContinuation = box.meta?.isContinuation === true;
            const style = box.style || {};
            const isSplitMarker = box.type === 'split-marker';
            const isBlockquote = box.type === 'blockquote';
            const keepWithNext = style.keepWithNext === true;
            const noSplit = style.allowLineSplit === false;
            const lineCount = box.lines?.length ?? 0;
            const isFirstFrag = firstFragIdx.has(bi);
            const isCont = !isSplitMarker && (isContinuation || fragIndex > 0);

            // ── Fragment seam + badge ──────────────────────────────────────────────
            // Only on content boxes, not on the injected split-marker labels.
            if (isCont) {
                // Teal dashed seam across the full box width at the join point.
                ctx.save();
                ctx.strokeColor('#0d9488').lineWidth(0.9).dash(3, { space: 2 }).opacity(0.8);
                ctx.moveTo(box.x, box.y)
                    .lineTo(box.x + box.w, box.y)
                    .stroke();
                ctx.undash();
                ctx.restore();

                // Navy "F{n}" pill in the left margin, top-aligned with the box.
                const bw = 18,
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

            // ── Line-count labels in the right margin ──────────────────────────────
            if (lineCount > 0 && (isFirstFrag || isCont)) {
                const color = isCont ? '#0d9488' : '#6366f1';
                ctx.save();
                ctx.fillColor(color).opacity(0.85);
                ctx.font('Helvetica', 6.5);
                ctx.text(`${lineCount}L`, RIGHT_EDGE + 4, box.y + 2, { lineBreak: false });
                ctx.restore();
            }

            // ── Split-marker amber pip ─────────────────────────────────────────────
            if (isSplitMarker) {
                ctx.save();
                ctx.fillColor('#f59e0b').opacity(0.85);
                ctx.roundedRect(LEFT_EDGE - 8, box.y + box.h / 2 - 3, 6, 6, 3).fill();
                ctx.restore();
            }

            // ── Keep-with-next chevron in the right margin ─────────────────────────
            if (keepWithNext) {
                const cx = RIGHT_EDGE + 6;
                const cy = box.y + box.h - 3;
                ctx.save();
                ctx.strokeColor('#0f4c81').lineWidth(1.2).opacity(0.7);
                ctx.moveTo(cx, cy - 4)
                    .lineTo(cx + 5, cy)
                    .lineTo(cx + 10, cy - 4)
                    .stroke();
                ctx.restore();
            }

            // ── No-split bar + badge in the left margin ────────────────────────────
            if (noSplit) {
                const barX = LEFT_EDGE - 6;
                ctx.save();
                ctx.strokeColor('#ec4899').lineWidth(2).opacity(0.55);
                ctx.moveTo(barX, box.y)
                    .lineTo(barX, box.y + box.h)
                    .stroke();
                ctx.restore();

                const pw = 16,
                    ph = 10;
                const px = barX - pw - 2;
                ctx.save();
                ctx.fillColor('#ec4899').opacity(0.75);
                ctx.roundedRect(px, box.y, pw, ph, 2).fill();
                ctx.fillColor('#ffffff').opacity(1);
                ctx.font('Helvetica', 6);
                ctx.text('NS', px + 4, box.y + 1.5, { lineBreak: false });
                ctx.restore();
            }

            // ── Blockquote content-inset dashed rect ──────────────────────────────
            if (isBlockquote) {
                const cm = box.properties?.__vmprintTextMetrics?.contentBox;
                if (cm && cm.w > 0 && cm.h > 0) {
                    ctx.save();
                    ctx.strokeColor('#1a73e8').lineWidth(0.5).dash(2, { space: 2 }).opacity(0.5);
                    ctx.rect(cm.x, cm.y, cm.w, cm.h).stroke();
                    ctx.undash();
                    ctx.restore();
                }
            }
        });
    },
};
