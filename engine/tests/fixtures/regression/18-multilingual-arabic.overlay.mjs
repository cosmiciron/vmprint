/**
 * 18-multilingual-arabic.overlay.mjs
 *
 * Overlay:
 *   Visualizes the directionality (LTR/RTL) of segments in the layout engine.
 *   - LTR segments get bounded by a faint green tint and LTR arrow.
 *   - RTL segments get bounded by a faint orange tint and RTL arrow.
 */

export default {
    overlay(page, ctx) {
        for (const box of page.boxes) {
            if (!box.lines || box.lines.length === 0) continue;

            const metrics = box.properties?.__vmprintTextMetrics;
            if (!metrics) continue;

            const contentX = metrics.contentBox.x;

            box.lines.forEach((line, li) => {
                const lineMeta = metrics.lines[li];
                if (!lineMeta) return;

                const { top: lineTop, baseline, height: lineH } = lineMeta;

                let segX = contentX;
                line.forEach((seg) => {
                    const w = seg.width || 0;
                    const isRtl = seg.direction === 'rtl';

                    // Draw background tint
                    ctx.save();
                    ctx.fillColor(isRtl ? '#f97316' : '#22c55e').opacity(0.15);
                    ctx.rect(segX, lineTop, w, lineH).fill();
                    ctx.restore();

                    // Draw underline with color
                    ctx.save();
                    ctx.strokeColor(isRtl ? '#ea580c' : '#16a34a').lineWidth(1.5).opacity(0.8);
                    ctx.moveTo(segX, baseline + 2).lineTo(segX + w, baseline + 2).stroke();
                    ctx.restore();

                    // Draw arrow in the middle
                    if (w > 10) {
                        const midX = segX + w / 2;
                        const arrowY = baseline + 6;
                        const arrowLen = Math.min(w / 4, 8);

                        ctx.save();
                        ctx.strokeColor(isRtl ? '#c2410c' : '#15803d').lineWidth(1).opacity(0.9);

                        if (isRtl) {
                            // RTL arrow (←)
                            ctx.moveTo(midX + arrowLen, arrowY).lineTo(midX - arrowLen, arrowY).stroke(); // shaft
                            ctx.moveTo(midX - arrowLen, arrowY).lineTo(midX - arrowLen + 3, arrowY - 2).stroke(); // head top
                            ctx.moveTo(midX - arrowLen, arrowY).lineTo(midX - arrowLen + 3, arrowY + 2).stroke(); // head bottom
                        } else {
                            // LTR arrow (→)
                            ctx.moveTo(midX - arrowLen, arrowY).lineTo(midX + arrowLen, arrowY).stroke(); // shaft
                            ctx.moveTo(midX + arrowLen, arrowY).lineTo(midX + arrowLen - 3, arrowY - 2).stroke(); // head top
                            ctx.moveTo(midX + arrowLen, arrowY).lineTo(midX + arrowLen - 3, arrowY + 2).stroke(); // head bottom
                        }

                        ctx.restore();
                    }

                    segX += w;
                });
            });
        }
    }
};
