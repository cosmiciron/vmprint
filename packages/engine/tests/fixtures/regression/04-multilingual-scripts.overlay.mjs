/**
 * 04-multilingual-scripts.overlay.mjs
 *
 * Overlay:
 *   1. (Original) Heading underline, RTL-box tick + label, font-family margin label.
 *   2. Ascent / descent bands — per-line amber fill above the baseline and sky fill
 *      below it, with a right-margin label showing actual ascent · descent in pts.
 *      This makes optical scaling differences between scripts immediately visible:
 *      CJK and Thai lines will have noticeably taller amber bands than Latin lines
 *      at the same nominal font size.
 *   3. Script-run colouring — per-segment fill band + solid baseline underline bar,
 *      keyed to Unicode script:
 *        CJK (Han / Hiragana / Katakana)  → indigo    #6366f1
 *        Arabic                            → amber     #f59e0b
 *        Hangul (Korean)                   → violet    #8b5cf6
 *        Thai                              → orange    #f97316
 *        Devanagari                        → rose      #ec4899
 *   4. Bidi direction arrows — in non-RTL boxes that contain Arabic runs alongside
 *      Latin runs, a small amber ← arrow is drawn below each Arabic (RTL) segment
 *      to distinguish inline bidi reordering from block-level direction.
 *   5. Grapheme-cluster marks — segments whose text contains ZWJ sequences,
 *      variation selectors, or Latin combining marks get a rose fill band, hairline
 *      tick marks at approximate cluster boundaries, and a compact "Ng" label.
 */

// ── Script detection ─────────────────────────────────────────────────────────

const SCRIPT_COLORS = {
    cjk: '#6366f1',
    arabic: '#f59e0b',
    korean: '#8b5cf6',
    thai: '#f97316',
    devanagari: '#ec4899',
};

function scriptOf(text) {
    for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (cp >= 0x0600 && cp <= 0x06ff) return 'arabic';
        if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x3400 && cp <= 0x4dbf))
            return 'cjk';
        if (cp >= 0xac00 && cp <= 0xd7ff) return 'korean';
        if (cp >= 0x0e00 && cp <= 0x0e7f) return 'thai';
        if (cp >= 0x0900 && cp <= 0x097f) return 'devanagari';
    }
    return 'latin';
}

// ── Grapheme-cluster helpers ──────────────────────────────────────────────────

// Only flag segments that contain the specific sequences the fixture tests:
// ZWJ (joiner), variation selectors, or Latin combining diacritical marks.
function hasNonTrivialClusters(text) {
    for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (cp === 0x200d) return true; // Zero-width joiner
        if (cp >= 0xfe00 && cp <= 0xfe0f) return true; // Variation selectors VS1-VS16
        if (cp >= 0xe0100 && cp <= 0xe01ef) return true; // Variation selectors supplement
        if (cp >= 0x0300 && cp <= 0x036f) return true; // Combining diacritical marks
    }
    return false;
}

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// ── Overlay ───────────────────────────────────────────────────────────────────

export default {
    overlay(page, ctx) {
        const marginRight = page.width - 8;

        for (const box of page.boxes) {
            const style = box.style || {};
            const isRtlBox = style.direction === 'rtl';
            const family = style.fontFamily;
            const isHeading = box.type === 'h1' || box.type === 'h2';

            // ── 1. Original annotations ─────────────────────────────────────────────

            if (isHeading) {
                ctx.save();
                ctx.strokeColor('#94a3b8').lineWidth(0.4).opacity(0.5);
                ctx.moveTo(box.x, box.y + box.h + 2)
                    .lineTo(box.x + box.w, box.y + box.h + 2)
                    .stroke();
                ctx.restore();
            }

            if (isRtlBox) {
                ctx.save();
                ctx.strokeColor('#b45309').lineWidth(1.2).opacity(0.8);
                ctx.moveTo(box.x + box.w + 4, box.y)
                    .lineTo(box.x + box.w + 4, box.y + box.h)
                    .stroke();
                ctx.fillColor('#b45309').opacity(0.8);
                ctx.font('Helvetica', 7);
                ctx.text('← RTL', box.x + box.w + 6, box.y + box.h / 2 + 2.5);
                ctx.restore();
            }

            if (family && !isHeading) {
                const shortFamily = family.replace('Noto Sans ', 'Noto ');
                ctx.save();
                ctx.fillColor('#0ea5e9').opacity(0.65);
                ctx.font('Helvetica', 6);
                ctx.text(shortFamily, marginRight - 72, box.y + box.h / 2 + 2);
                ctx.restore();
            }

            // ── 2–5. Per-line annotations (headings excluded) ───────────────────────

            if (isHeading) continue;

            const lines = box.lines || [];
            const metrics = box.properties?.__vmprintTextMetrics;
            if (!lines.length || !metrics) continue;

            const contentX = metrics.contentBox.x;

            lines.forEach((line, li) => {
                const lineMeta = metrics.lines[li];
                if (!lineMeta) return;

                const { top: lineTop, baseline, height: lineH, ascent, descent } = lineMeta;
                const lineTextWidth = line.reduce((sum, seg) => sum + (seg.width || 0), 0);

                // ── 2. Ascent / descent bands ──────────────────────────────────────────
                if (ascent > 0) {
                    ctx.save();
                    ctx.fillColor('#f59e0b').opacity(0.09);
                    ctx.rect(contentX, baseline - ascent, lineTextWidth, ascent).fill();
                    ctx.restore();
                }
                if (descent > 0) {
                    ctx.save();
                    ctx.fillColor('#0ea5e9').opacity(0.09);
                    ctx.rect(contentX, baseline, lineTextWidth, descent).fill();
                    ctx.restore();
                }

                // Right-margin optical scaling label
                ctx.save();
                ctx.fillColor('#9ca3af').opacity(0.75);
                ctx.font('Helvetica', 5);
                ctx.text(`^${ascent.toFixed(1)} v${descent.toFixed(1)}`, marginRight - 44, lineTop + lineH / 2 + 1.5);
                ctx.restore();

                // ── 3. Script-run colouring ────────────────────────────────────────────
                const segScripts = line.map((seg) => scriptOf(seg.text || ''));
                const scriptSet = new Set(segScripts);
                const hasNonLatin = scriptSet.size > 1 || !scriptSet.has('latin');

                if (hasNonLatin) {
                    let segX = contentX;
                    segScripts.forEach((script, si) => {
                        const w = line[si].width || 0;
                        const color = SCRIPT_COLORS[script];
                        if (color) {
                            ctx.save();
                            ctx.fillColor(color).opacity(0.14);
                            ctx.rect(segX, lineTop, w, lineH).fill();
                            ctx.restore();

                            ctx.save();
                            ctx.strokeColor(color).lineWidth(1.5).opacity(0.72);
                            ctx.moveTo(segX, baseline + 1)
                                .lineTo(segX + w, baseline + 1)
                                .stroke();
                            ctx.restore();
                        }
                        segX += w;
                    });
                }

                // ── 4. Bidi direction arrows ───────────────────────────────────────────
                // Only fires inside non-RTL boxes that contain both Arabic and non-Arabic
                // runs on the same line — i.e., genuine inline bidi reordering.
                if (!isRtlBox) {
                    const hasArabicRun = segScripts.some((s) => s === 'arabic');
                    const hasNonArabicRun = segScripts.some((s) => s !== 'arabic');

                    if (hasArabicRun && hasNonArabicRun) {
                        // Arrow sits just below the descent so it never overlaps glyphs.
                        const arrowY = baseline + Math.max(descent, 1.5) + 1.5;
                        let segX = contentX;

                        segScripts.forEach((script, si) => {
                            const w = line[si].width || 0;
                            if (script === 'arabic' && w > 6) {
                                const midX = segX + w / 2;
                                const halfLen = Math.min(w / 2 - 1, 6);

                                ctx.save();
                                ctx.strokeColor('#b45309').lineWidth(0.8).opacity(0.85);
                                // Shaft: right → left
                                ctx.moveTo(midX + halfLen, arrowY)
                                    .lineTo(midX - halfLen, arrowY)
                                    .stroke();
                                // Arrowhead at the left tip
                                ctx.moveTo(midX - halfLen, arrowY)
                                    .lineTo(midX - halfLen + 2.5, arrowY - 1.5)
                                    .stroke();
                                ctx.moveTo(midX - halfLen, arrowY)
                                    .lineTo(midX - halfLen + 2.5, arrowY + 1.5)
                                    .stroke();
                                ctx.restore();
                            }
                            segX += w;
                        });
                    }
                }

                // ── 5. Grapheme-cluster marks ──────────────────────────────────────────
                let segX = contentX;
                line.forEach((seg) => {
                    const w = seg.width || 0;
                    const text = seg.text || '';

                    if (hasNonTrivialClusters(text)) {
                        const clusters = [...GRAPHEME_SEGMENTER.segment(text)].map((s) => s.segment);
                        const cpCount = [...text].length;

                        if (clusters.length < cpCount && clusters.length > 0) {
                            // Rose fill band marking the complex segment
                            ctx.save();
                            ctx.fillColor('#ec4899').opacity(0.18);
                            ctx.rect(segX, lineTop, w, lineH).fill();
                            ctx.restore();

                            // Tick marks at approximate cluster boundaries (equal-width split)
                            if (clusters.length > 1) {
                                const clusterW = w / clusters.length;
                                for (let ci = 1; ci < clusters.length; ci++) {
                                    const tickX = segX + ci * clusterW;
                                    ctx.save();
                                    ctx.strokeColor('#ec4899').lineWidth(0.7).opacity(0.65);
                                    ctx.moveTo(tickX, baseline - 4)
                                        .lineTo(tickX, baseline + 1)
                                        .stroke();
                                    ctx.restore();
                                }
                            }

                            // Cluster count label at the top-left of the segment
                            ctx.save();
                            ctx.fillColor('#ec4899').opacity(0.9);
                            ctx.font('Helvetica', 5);
                            ctx.text(`${clusters.length}g`, segX + 1, lineTop + 1);
                            ctx.restore();
                        }
                    }

                    segX += w;
                });
            });
        }
    },
};
