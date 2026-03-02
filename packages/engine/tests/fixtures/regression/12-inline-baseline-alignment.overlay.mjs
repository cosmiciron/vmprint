/**
 * 12-inline-baseline-alignment.overlay.mjs
 *
 * Visual diagnostics for inline vertical alignment behavior:
 * - Line box bands (ascent/descent) and baseline rules.
 * - Inline object advance slots, with estimated ink bounds.
 * - Variant badges parsed from fixture copy:
 *   baseline, middle, text-top, text-bottom, bottom, neutral.
 */

const VARIANT_COLORS = {
    baseline: '#ef4444',
    middle: '#0ea5e9',
    'text-top': '#8b5cf6',
    'text-bottom': '#f59e0b',
    bottom: '#22c55e',
    neutral: '#64748b',
    unknown: '#334155',
};

function variantFromText(lineText) {
    if (!lineText) return 'unknown';

    const variantMatch = /Variant\s+\d+\s+\(([^)]+)\)/i.exec(lineText);
    if (variantMatch) {
        const key = variantMatch[1].trim().toLowerCase();
        return VARIANT_COLORS[key] ? key : 'unknown';
    }

    if (/Neutral\s+[A-Z]/i.test(lineText)) return 'neutral';
    return 'unknown';
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
    if (hasObjectReplacementChar(String(seg.text || ''))) return true;

    const family = String(seg.fontFamily || '').trim();
    const ascent = Number(seg.ascent || 0);
    const descent = Number(seg.descent || 0);

    // Defensive fallback: object segments commonly have no family and large ascent.
    if (!family && ascent >= 1000 && descent <= 100) return true;

    return false;
}

function safeNumber(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function textNoBreak(ctx, str, x, y, size = 5.5, color = '#334155', opacity = 0.85) {
    ctx.save();
    ctx.fillColor(color).opacity(opacity).font('Helvetica', size);
    ctx.text(str, x, y, { lineBreak: false });
    ctx.restore();
}

export default {
    overlay(page, ctx) {
        const boxes = Array.isArray(page.boxes) ? page.boxes : [];
        if (!boxes.length) return;

        const leftEdge = boxes.reduce((min, b) => (b.x > 0 && b.x < min ? b.x : min), page.width);
        const rightEdge = page.width - leftEdge;
        const contentTop = boxes.reduce((min, b) => Math.min(min, b.y), page.height);
        const contentBottom = boxes.reduce((max, b) => Math.max(max, b.y + b.h), 0);

        // Content area guides.
        ctx.save();
        ctx.strokeColor('#94a3b8').lineWidth(0.35).dash(5, { space: 5 }).opacity(0.2);
        ctx.rect(leftEdge, contentTop, rightEdge - leftEdge, contentBottom - contentTop).stroke();
        ctx.moveTo(leftEdge, contentTop).lineTo(leftEdge, contentBottom).stroke();
        ctx.moveTo(rightEdge, contentTop).lineTo(rightEdge, contentBottom).stroke();
        ctx.undash();
        ctx.restore();

        // Legend on page 1.
        if (page.index === 0) {
            const rowH = 9;
            const rows = 7;
            const legendW = 176;
            const legendH = rows * rowH + 16;
            const legendX = rightEdge - legendW;
            const legendY = page.height - leftEdge - legendH;

            ctx.save();
            ctx.fillColor('#f8fafc').opacity(0.95);
            ctx.rect(legendX, legendY, legendW, legendH).fill();
            ctx.strokeColor('#94a3b8').lineWidth(0.5).opacity(0.65);
            ctx.rect(legendX, legendY, legendW, legendH).stroke();
            ctx.restore();

            textNoBreak(ctx, 'Overlay key', legendX + 4, legendY + 3, 6.5, '#374151', 0.9);
            ctx.save();
            ctx.strokeColor('#cbd5e1').lineWidth(0.4).opacity(0.8);
            ctx.moveTo(legendX, legendY + 12)
                .lineTo(legendX + legendW, legendY + 12)
                .stroke();
            ctx.restore();

            const ix = legendX + 4;
            const tx = legendX + 32;
            const row = (i) => ({ y: legendY + 16 + i * rowH });

            // Row 0: baseline rule.
            {
                const { y } = row(0);
                ctx.save();
                ctx.strokeColor('#ef4444').lineWidth(0.7).opacity(0.65);
                ctx.moveTo(ix, y + 4)
                    .lineTo(ix + 22, y + 4)
                    .stroke();
                ctx.restore();
                textNoBreak(ctx, 'line baseline', tx, y + 1, 5.5);
            }

            // Row 1: ascent + descent band.
            {
                const { y } = row(1);
                ctx.save();
                ctx.fillColor('#f59e0b').opacity(0.16);
                ctx.rect(ix, y, 22, 4).fill();
                ctx.fillColor('#38bdf8').opacity(0.16);
                ctx.rect(ix, y + 4, 22, 4).fill();
                ctx.restore();
                textNoBreak(ctx, 'ascent (amber) / descent (sky)', tx, y + 1, 5.5);
            }

            // Row 2: object slot + estimated ink.
            {
                const { y } = row(2);
                ctx.save();
                ctx.fillColor('#475569').opacity(0.1);
                ctx.rect(ix, y, 22, 8).fill();
                ctx.strokeColor('#334155').lineWidth(0.6).dash(2, { space: 2 }).opacity(0.85);
                ctx.rect(ix + 2, y + 1, 18, 6).stroke();
                ctx.undash();
                ctx.restore();
                textNoBreak(ctx, 'inline advance slot + ink estimate', tx, y + 1, 5.5);
            }

            // Row 3..6: variant colors.
            [
                ['baseline', 'baseline variant color'],
                ['middle', 'middle variant color'],
                ['text-top', 'text-top / text-bottom color family'],
                ['bottom', 'bottom variant color'],
            ].forEach(([variant, label], i) => {
                const { y } = row(3 + i);
                const color = VARIANT_COLORS[variant];
                ctx.save();
                ctx.fillColor(color).opacity(0.6);
                ctx.roundedRect(ix, y + 1, 22, 7, 2).fill();
                ctx.restore();
                textNoBreak(ctx, label, tx, y + 1, 5.5);
            });
        }

        for (const box of boxes) {
            const metrics = box.properties?.__vmprintTextMetrics;
            if (!metrics?.lines || !Array.isArray(box.lines) || box.lines.length === 0) continue;

            const contentX = safeNumber(metrics.contentBox?.x, box.x);

            box.lines.forEach((line, li) => {
                const lineMeta = metrics.lines?.[li];
                if (!lineMeta || !Array.isArray(line) || line.length === 0) return;

                const objects = line.map((seg, idx) => ({ seg, idx })).filter(({ seg }) => isInlineObjectSegment(seg));
                if (!objects.length) return;

                const lineText = line.map((seg) => String(seg.text || '')).join('');
                const variant = variantFromText(lineText);
                const variantColor = VARIANT_COLORS[variant] || VARIANT_COLORS.unknown;

                const lineTop = safeNumber(lineMeta.top, box.y);
                const lineH = safeNumber(lineMeta.height, box.h);
                const baseline = safeNumber(lineMeta.baseline, lineTop + lineH * 0.8);
                const ascent = safeNumber(lineMeta.ascent, Math.max(1, lineH * 0.7));
                const descent = safeNumber(lineMeta.descent, Math.max(1, lineH * 0.25));
                const lineWidth = line.reduce((sum, seg) => sum + safeNumber(seg.width, 0), 0);

                // Line ascent/descent bands.
                ctx.save();
                ctx.fillColor('#f59e0b').opacity(0.08);
                ctx.rect(contentX, baseline - ascent, lineWidth, ascent).fill();
                ctx.fillColor('#38bdf8').opacity(0.08);
                ctx.rect(contentX, baseline, lineWidth, descent).fill();
                ctx.restore();

                // Baseline rule.
                ctx.save();
                ctx.strokeColor('#ef4444').lineWidth(0.6).opacity(0.5);
                ctx.moveTo(contentX, baseline)
                    .lineTo(contentX + lineWidth, baseline)
                    .stroke();
                ctx.restore();

                // Variant pill near left edge of line.
                const pillLabel = variant === 'unknown' ? 'inline' : variant;
                const pillW = Math.ceil(pillLabel.length * 3.4 + 10);
                const pillH = 8;
                const pillY = Math.max(contentTop - 2, lineTop - pillH - 1);
                ctx.save();
                ctx.fillColor(variantColor).opacity(0.8);
                ctx.roundedRect(contentX, pillY, pillW, pillH, 2).fill();
                ctx.fillColor('#ffffff').opacity(1).font('Helvetica', 5.2);
                ctx.text(pillLabel, contentX + 3, pillY + 1.5, { lineBreak: false });
                ctx.restore();

                // Inline objects on the line.
                let segX = contentX;
                line.forEach((seg, segIndex) => {
                    const segW = safeNumber(seg.width, 0);
                    if (segW <= 0) return;

                    const isObj = objects.some((obj) => obj.idx === segIndex);
                    if (!isObj) {
                        segX += segW;
                        return;
                    }

                    const segAscent = Math.max(
                        2,
                        (safeNumber(seg.ascent, 1000) / 1000) * safeNumber(lineMeta.fontSize, 12),
                    );
                    const segDescent = Math.max(
                        0,
                        (safeNumber(seg.descent, 0) / 1000) * safeNumber(lineMeta.fontSize, 12),
                    );
                    const inkTop = baseline - segAscent;
                    const inkH = Math.max(2, segAscent + segDescent);

                    // Advance slot.
                    ctx.save();
                    ctx.fillColor(variantColor).opacity(0.09);
                    ctx.rect(segX, lineTop, segW, lineH).fill();
                    ctx.restore();

                    // Estimated object ink box.
                    ctx.save();
                    ctx.strokeColor(variantColor).lineWidth(0.7).dash(2, { space: 2 }).opacity(0.9);
                    ctx.rect(segX, inkTop, segW, inkH).stroke();
                    ctx.undash();
                    ctx.restore();

                    // Baseline tick at object center.
                    const cx = segX + segW / 2;
                    ctx.save();
                    ctx.strokeColor(variantColor).lineWidth(0.6).opacity(0.7);
                    ctx.moveTo(cx, baseline - 3)
                        .lineTo(cx, baseline + 3)
                        .stroke();
                    ctx.restore();

                    textNoBreak(
                        ctx,
                        `${Math.round(segW)}pt`,
                        segX + 1,
                        baseline + Math.max(3, descent) + 1.5,
                        4.8,
                        variantColor,
                        0.75,
                    );

                    segX += segW;
                });
            });
        }
    },
};
