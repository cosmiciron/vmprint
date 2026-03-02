function drawArrow(ctx, x1, y1, x2, y2, size) {
    ctx.moveTo(x1, y1).lineTo(x2, y2).stroke();

    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;

    const bx = x2 - ux * size;
    const by = y2 - uy * size;

    ctx.moveTo(x2, y2)
        .lineTo(bx + px * size * 0.55, by + py * size * 0.55)
        .stroke();
    ctx.moveTo(x2, y2)
        .lineTo(bx - px * size * 0.55, by - py * size * 0.55)
        .stroke();
}

function badge(ctx, x, y, text) {
    const r = 7;
    ctx.save();
    ctx.lineWidth(0.8).strokeColor('#0f172a').fillColor('#f8fafc').opacity(0.95);
    ctx.roundedRect(x - r, y - r, r * 2, r * 2, r).fillAndStroke();
    ctx.fillColor('#0f172a').opacity(1).fontSize(6.5);
    ctx.text(String(text), x - 2.1, y - 3.8);
    ctx.restore();
}

function getLineMetrics(box) {
    const metrics = box?.properties?.__vmprintTextMetrics;
    if (!metrics || !Array.isArray(metrics.lines)) {
        return [];
    }
    return metrics.lines
        .map((line) => ({
            index: Number(line?.index),
            top: Number(line?.top),
            baseline: Number(line?.baseline),
            bottom: Number(line?.bottom),
            ascent: Number(line?.ascent),
            descent: Number(line?.descent),
        }))
        .filter((line) => Number.isFinite(line.top) && Number.isFinite(line.baseline) && Number.isFinite(line.bottom));
}

function getCausalityTag(box) {
    const type = String(box?.type || '');
    if (type === 'displayLatinA') return 'A';
    if (type === 'displayLatinB') return 'B';
    return '';
}

export default {
    backdrop(page, ctx) {
        ctx.save();

        // Subtle graph-paper rhythm to echo typographic measurement diagrams.
        ctx.strokeColor('#cbd5e1').lineWidth(0.35).dash(2, { space: 5 }).opacity(0.45);
        for (let y = 40; y < page.height - 20; y += 18) {
            ctx.moveTo(24, y)
                .lineTo(page.width - 24, y)
                .stroke();
        }
        ctx.undash();

        ctx.restore();
    },

    overlay(page, ctx) {
        const focus = page.boxes.filter((box) => box.h >= 40);
        if (focus.length === 0) {
            return;
        }

        const guideLeft = 36;

        ctx.save();
        ctx.strokeColor('#111827').lineWidth(1.1).opacity(0.85);
        ctx.moveTo(24, 30)
            .lineTo(page.width - 24, 30)
            .stroke();
        ctx.fillColor('#111827').fontSize(11);
        ctx.text('Glyph-Metric Geometry Overlay', 28, 16);
        ctx.fontSize(7.2).fillColor('#334155').opacity(0.95);
        ctx.text('Eq: top=bN-aN | bot=bN+dN | h=aN+dN', 28, 31.5);
        ctx.restore();

        focus.forEach((box, idx) => {
            const n = idx + 1;
            const top = box.y;
            const bottom = box.y + box.h;
            const widthY = bottom + 11;
            const lineMetrics = getLineMetrics(box);

            ctx.save();

            // Main measured box.
            ctx.opacity(0.9).lineWidth(1).strokeColor('#0f172a').dash(5, { space: 3 });
            ctx.rect(box.x, box.y, box.w, box.h).stroke();
            ctx.undash();

            // Typographic horizontal guides.
            ctx.lineWidth(0.8).strokeColor('#2563eb').opacity(0.75).dash(3, { space: 3 });
            ctx.moveTo(24, top)
                .lineTo(page.width - 24, top)
                .stroke();
            ctx.strokeColor('#7c3aed');
            ctx.moveTo(24, bottom)
                .lineTo(page.width - 24, bottom)
                .stroke();
            ctx.undash();

            // True line metrics from renderer internals.
            const showAllLineLabels = lineMetrics.length <= 2;
            lineMetrics.forEach((line, lineIdx) => {
                const lineNo = lineIdx + 1;
                const ascentY =
                    Number.isFinite(line.ascent) && line.ascent > 0 ? line.baseline - line.ascent : line.top;
                const descentY =
                    Number.isFinite(line.descent) && line.descent > 0 ? line.baseline + line.descent : line.bottom;
                const isEdgeLine = lineIdx === 0 || lineIdx === lineMetrics.length - 1;
                const showLabels = showAllLineLabels || isEdgeLine;
                const lineOpacity = showAllLineLabels || isEdgeLine ? 0.72 : 0.42;

                ctx.lineWidth(0.8).strokeColor('#0ea5e9').opacity(lineOpacity).dash(3, { space: 3 });
                ctx.moveTo(24, ascentY)
                    .lineTo(page.width - 24, ascentY)
                    .stroke();
                ctx.lineWidth(0.8)
                    .strokeColor('#16a34a')
                    .opacity(showAllLineLabels || isEdgeLine ? 0.82 : 0.5)
                    .dash(3, { space: 3 });
                ctx.moveTo(24, line.baseline)
                    .lineTo(page.width - 24, line.baseline)
                    .stroke();
                ctx.lineWidth(0.8).strokeColor('#f59e0b').opacity(lineOpacity).dash(3, { space: 3 });
                ctx.moveTo(24, descentY)
                    .lineTo(page.width - 24, descentY)
                    .stroke();
                ctx.undash();

                if (showLabels) {
                    ctx.fillColor('#1e293b').fontSize(7.1);
                    ctx.text(`a${lineNo}`, page.width - 86, ascentY - 8);
                    ctx.text(`b${lineNo}`, page.width - 74, line.baseline - 8);
                    ctx.text(`d${lineNo}`, page.width - 62, descentY - 8);
                }
            });

            // Height arrow.
            ctx.lineWidth(1).strokeColor('#111827').opacity(0.9);
            drawArrow(ctx, guideLeft, bottom, guideLeft, top, 6);
            drawArrow(ctx, guideLeft, top, guideLeft, bottom, 6);
            ctx.fontSize(8).fillColor('#111827');
            const heightLabelX = guideLeft + 8;
            const heightLabelY = top + box.h / 2;
            ctx.save();
            ctx.translate(heightLabelX, heightLabelY);
            ctx.rotate(-90);
            ctx.text(`${box.h.toFixed(2)} pt`, 0, 0);
            ctx.restore();

            // Width arrow.
            drawArrow(ctx, box.x, widthY, box.x + box.w, widthY, 6);
            drawArrow(ctx, box.x + box.w, widthY, box.x, widthY, 6);
            ctx.text(`${box.w.toFixed(2)} pt`, box.x + box.w * 0.5 - 18, widthY - 11);

            // Labels and numeric callouts.
            ctx.fillColor('#1e293b').fontSize(7.3);
            ctx.text('top', page.width - 60, top - 8);
            ctx.text('bottom', page.width - 60, bottom - 8);

            badge(ctx, guideLeft - 11, top, n);
            badge(ctx, guideLeft - 11, bottom, `${n}b`);
            badge(ctx, box.x + box.w / 2, widthY + 8, `${n}w`);

            const causalityTag = getCausalityTag(box);
            if (causalityTag) {
                badge(ctx, box.x + 9, top + 10, causalityTag);
            }

            ctx.restore();
        });

        ctx.save();
        ctx.fontSize(7.5).fillColor('#334155').opacity(0.95);
        ctx.text('aN/bN/dN are renderer line metrics (ascent/baseline/descent).', 28, page.height - 30);
        ctx.text('A/B uses identical text with different metric inputs.', 28, page.height - 20);
        ctx.restore();
    },
};
