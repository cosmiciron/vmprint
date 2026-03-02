/**
 * 14-flow-images-multipage.overlay.mjs
 *
 * Visual diagnostics for normal-flow image pagination:
 * - Sequence badges for every image in document order.
 * - Full-width flow lanes (top-bottom behavior emphasis).
 * - Page-to-page continuity callouts when image sequence crosses pages.
 * - Per-page summary: image count, text box count, and line count.
 */

const IMAGE_PALETTE = ['#0ea5e9', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6'];

let globalImageOrdinal = 0;
let previousImage = null; // { ordinal, pageIndex, centerX, centerY }

function resetState() {
    globalImageOrdinal = 0;
    previousImage = null;
}

function safeNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function colorForOrdinal(ordinal) {
    return IMAGE_PALETTE[(Math.max(1, ordinal) - 1) % IMAGE_PALETTE.length];
}

function textNoBreak(ctx, str, x, y, size = 5.5, color = '#334155', opacity = 0.85) {
    ctx.save();
    ctx.fillColor(color).opacity(opacity).font('Helvetica', size);
    ctx.text(str, x, y, { lineBreak: false });
    ctx.restore();
}

function lineCountForBox(box) {
    const lines = box?.properties?.__vmprintTextMetrics?.lines;
    return Array.isArray(lines) ? lines.length : 0;
}

export default {
    overlay(page, ctx) {
        const boxes = Array.isArray(page.boxes) ? page.boxes : [];
        if (!boxes.length) return;
        if (page.index === 0) resetState();

        const leftEdge = boxes.reduce((min, b) => (b.x > 0 && b.x < min ? b.x : min), page.width);
        const rightEdge = page.width - leftEdge;
        const contentTop = boxes.reduce((min, b) => Math.min(min, b.y), page.height);
        const contentBottom = boxes.reduce((max, b) => Math.max(max, b.y + b.h), 0);
        const contentWidth = Math.max(1, rightEdge - leftEdge);

        const textBoxes = boxes.filter((b) => Array.isArray(b.lines) && b.lines.length > 0);
        const imageBoxes = boxes.filter((b) => b.type === 'image');
        const pageLineCount = textBoxes.reduce((sum, b) => sum + lineCountForBox(b), 0);

        // Content guides and cinematic side rails.
        ctx.save();
        ctx.strokeColor('#94a3b8').lineWidth(0.3).dash(5, { space: 5 }).opacity(0.18);
        ctx.rect(leftEdge, contentTop, contentWidth, contentBottom - contentTop).stroke();
        ctx.undash();
        ctx.restore();

        ctx.save();
        ctx.fillColor('#0f172a').opacity(0.04);
        ctx.rect(leftEdge - 10, contentTop, 6, contentBottom - contentTop).fill();
        ctx.rect(rightEdge + 4, contentTop, 6, contentBottom - contentTop).fill();
        ctx.restore();

        // Legend on first page.
        if (page.index === 0) {
            const rowH = 9;
            const rows = 6;
            const lw = 188;
            const lh = rows * rowH + 16;
            const lx = rightEdge - lw;
            const ly = page.height - leftEdge - lh;

            ctx.save();
            ctx.fillColor('#f8fafc').opacity(0.95);
            ctx.rect(lx, ly, lw, lh).fill();
            ctx.strokeColor('#94a3b8').lineWidth(0.5).opacity(0.6);
            ctx.rect(lx, ly, lw, lh).stroke();
            ctx.restore();

            textNoBreak(ctx, 'Flow Image Overlay Key', lx + 4, ly + 3, 6.5, '#374151', 0.92);
            ctx.save();
            ctx.strokeColor('#cbd5e1').lineWidth(0.4).opacity(0.8);
            ctx.moveTo(lx, ly + 12)
                .lineTo(lx + lw, ly + 12)
                .stroke();
            ctx.restore();

            const iconX = lx + 4;
            const descX = lx + 31;
            const rowY = (i) => ly + 16 + i * rowH;

            // Row 0: lane fill.
            {
                const y = rowY(0);
                ctx.save();
                ctx.fillColor('#0ea5e9').opacity(0.1);
                ctx.rect(iconX, y, 22, 8).fill();
                ctx.restore();
                textNoBreak(ctx, 'full-width flow lane (top-bottom)', descX, y + 1);
            }

            // Row 1: top/bottom lane rules.
            {
                const y = rowY(1);
                ctx.save();
                ctx.strokeColor('#0ea5e9').lineWidth(0.5).dash(3, { space: 3 }).opacity(0.7);
                ctx.moveTo(iconX, y + 1)
                    .lineTo(iconX + 22, y + 1)
                    .stroke();
                ctx.moveTo(iconX, y + 7)
                    .lineTo(iconX + 22, y + 7)
                    .stroke();
                ctx.undash();
                ctx.restore();
                textNoBreak(ctx, 'entry/exit rules for image lane', descX, y + 1);
            }

            // Row 2: image frame and badge.
            {
                const y = rowY(2);
                ctx.save();
                ctx.strokeColor('#22c55e').lineWidth(0.7).dash(2, { space: 2 }).opacity(0.85);
                ctx.rect(iconX + 2, y + 1, 18, 6).stroke();
                ctx.undash();
                ctx.fillColor('#22c55e').opacity(0.85);
                ctx.roundedRect(iconX + 1, y - 6, 14, 6, 2).fill();
                ctx.fillColor('#ffffff').opacity(1).font('Helvetica', 4.8);
                ctx.text('IMG 1', iconX + 2, y - 5, { lineBreak: false });
                ctx.restore();
                textNoBreak(ctx, 'sequence frame + ordinal badge', descX, y + 1);
            }

            // Row 3: order connector.
            {
                const y = rowY(3);
                ctx.save();
                ctx.strokeColor('#64748b').lineWidth(0.6).dash(2, { space: 2 }).opacity(0.65);
                ctx.moveTo(iconX, y + 4)
                    .lineTo(iconX + 22, y + 4)
                    .stroke();
                ctx.undash();
                ctx.restore();
                textNoBreak(ctx, 'order connector (same page)', descX, y + 1);
            }

            // Row 4: page handoff.
            {
                const y = rowY(4);
                textNoBreak(ctx, 'p2 <- IMG 3', iconX, y + 1, 5.2, '#7c3aed', 0.85);
                textNoBreak(ctx, 'cross-page continuity callout', descX, y + 1);
            }

            // Row 5: occupancy.
            {
                const y = rowY(5);
                textNoBreak(ctx, 'lane 91%', iconX, y + 1, 5.2, '#0f766e', 0.9);
                textNoBreak(ctx, 'image width / content width', descX, y + 1);
            }
        }

        // Page header summary.
        const gutterY = Math.max(8, leftEdge / 2);
        ctx.save();
        ctx.strokeColor('#cbd5e1').lineWidth(0.35).opacity(0.7);
        ctx.moveTo(leftEdge, gutterY + 4)
            .lineTo(rightEdge, gutterY + 4)
            .stroke();
        ctx.restore();
        textNoBreak(ctx, `page ${page.index + 1}`, leftEdge, gutterY, 6, '#94a3b8', 0.82);
        textNoBreak(
            ctx,
            `${imageBoxes.length} images | ${textBoxes.length} text boxes | ${pageLineCount} lines`,
            rightEdge - 132,
            gutterY,
            6,
            '#64748b',
            0.82,
        );

        let firstImageOnPage = null;

        // Per-image overlays.
        imageBoxes.forEach((box) => {
            globalImageOrdinal += 1;
            const ordinal = globalImageOrdinal;
            const color = colorForOrdinal(ordinal);
            const occupancy = Math.round((box.w / contentWidth) * 100);
            const centerX = box.x + box.w / 2;
            const centerY = box.y + box.h / 2;

            if (!firstImageOnPage) firstImageOnPage = { ordinal, centerX, centerY };

            // Flow lane fill and rules across full content width.
            ctx.save();
            ctx.fillColor(color).opacity(0.08);
            ctx.rect(leftEdge, box.y, contentWidth, box.h).fill();
            ctx.strokeColor(color).lineWidth(0.5).dash(4, { space: 3 }).opacity(0.6);
            ctx.moveTo(leftEdge, box.y).lineTo(rightEdge, box.y).stroke();
            ctx.moveTo(leftEdge, box.y + box.h)
                .lineTo(rightEdge, box.y + box.h)
                .stroke();
            ctx.undash();
            ctx.restore();

            // Actual image frame.
            ctx.save();
            ctx.strokeColor(color).lineWidth(0.8).dash(3, { space: 2 }).opacity(0.9);
            ctx.rect(box.x, box.y, box.w, box.h).stroke();
            ctx.undash();
            ctx.restore();

            // Sequence badge and sizing.
            const badge = `IMG ${ordinal}`;
            const bw = Math.ceil(badge.length * 3.8 + 10);
            const bh = 9;
            const bx = box.x + 2;
            const by = Math.max(gutterY + 8, box.y - bh - 2);
            ctx.save();
            ctx.fillColor(color).opacity(0.87);
            ctx.roundedRect(bx, by, bw, bh, 2).fill();
            ctx.fillColor('#ffffff').opacity(1).font('Helvetica', 5.3);
            ctx.text(badge, bx + 3, by + 2, { lineBreak: false });
            ctx.restore();

            textNoBreak(
                ctx,
                `${Math.round(box.w)}x${Math.round(box.h)}  lane ${occupancy}%`,
                box.x + 2,
                box.y + 3,
                5,
                '#ffffff',
                0.92,
            );

            // Connector to previous image.
            if (previousImage) {
                if (previousImage.pageIndex === page.index) {
                    const railX = rightEdge + 7;
                    ctx.save();
                    ctx.strokeColor('#64748b').lineWidth(0.55).dash(2, { space: 2 }).opacity(0.55);
                    ctx.moveTo(previousImage.centerX, previousImage.centerY)
                        .lineTo(railX, previousImage.centerY)
                        .stroke();
                    ctx.moveTo(railX, previousImage.centerY).lineTo(railX, centerY).stroke();
                    ctx.moveTo(railX, centerY).lineTo(centerX, centerY).stroke();
                    ctx.undash();
                    ctx.restore();
                }
            }

            previousImage = { ordinal, pageIndex: page.index, centerX, centerY };
        });

        // Cross-page continuity callout.
        if (firstImageOnPage && previousImage && previousImage.pageIndex === page.index && page.index > 0) {
            const priorOrdinal = firstImageOnPage.ordinal - 1;
            if (priorOrdinal >= 1) {
                textNoBreak(ctx, `from IMG ${priorOrdinal}`, leftEdge, contentTop - 8, 5.5, '#7c3aed', 0.8);
            }
        }
    },
};
