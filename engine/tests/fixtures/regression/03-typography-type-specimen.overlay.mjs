/**
 * 03-typography-type-specimen.overlay.mjs
 *
 * Overlay:
 *   • Right-margin labels for fontPreview / weightLine / weightLineNoto boxes
 *     (unchanged from original).
 *   • In any box whose lines contain non-Latin text, each segment is highlighted
 *     with a semi-transparent coloured fill band keyed to its Unicode script,
 *     plus a solid underline bar at the segment's baseline:
 *       CJK (Han / Hiragana / Katakana)  → indigo    #6366f1
 *       Arabic                            → amber     #f59e0b
 *       Hangul (Korean)                   → violet    #8b5cf6
 *       Thai                              → orange    #f97316
 *       Devanagari                        → rose      #ec4899
 *   • For every line that contains two or more distinct scripts the true
 *     baseline (from __vmprintTextMetrics) is drawn as a faint red rule so
 *     cross-script baseline rhythm can be inspected visually.
 */

const LABEL_TYPES = new Set(['fontPreview', 'weightLine', 'weightLineNoto', 'weightPreview']);

const SCRIPT_COLORS = {
  cjk:        '#6366f1',
  arabic:     '#f59e0b',
  korean:     '#8b5cf6',
  thai:       '#f97316',
  devanagari: '#ec4899',
};

function scriptOf(text) {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x0600 && cp <= 0x06FF) return 'arabic';
    if ((cp >= 0x4E00 && cp <= 0x9FFF) ||
        (cp >= 0x3040 && cp <= 0x30FF) ||
        (cp >= 0x3400 && cp <= 0x4DBF)) return 'cjk';
    if (cp >= 0xAC00 && cp <= 0xD7FF) return 'korean';
    if (cp >= 0x0E00 && cp <= 0x0E7F) return 'thai';
    if (cp >= 0x0900 && cp <= 0x097F) return 'devanagari';
  }
  return 'latin';
}

export default {
  overlay(page, ctx) {
    const rightEdge = page.width - 8;

    for (const box of page.boxes) {
      // ── Right-margin labels (original behaviour) ──────────────────────────
      if (LABEL_TYPES.has(box.type)) {
        const style = box.style || {};
        const weight = style.fontWeight != null ? String(style.fontWeight) : '';
        const family = style.fontFamily || '';
        const isItalic = style.fontStyle === 'italic';

        let label = box.type;
        if (family) label = family;
        if (weight) label += '  ' + weight;
        if (isItalic) label += '  ital';

        ctx.save();
        ctx.fillColor('#94a3b8').opacity(0.7);
        ctx.font('Helvetica', 6);
        ctx.text(label, rightEdge - 80, box.y + (box.h / 2) + 2);
        ctx.strokeColor('#e2e8f0').lineWidth(0.3).opacity(0.5);
        ctx.moveTo(rightEdge, box.y).lineTo(rightEdge, box.y + box.h).stroke();
        ctx.restore();
      }

      // ── Mixed-script segment coloring + baseline ──────────────────────────
      const lines = box.lines || [];
      if (!lines.length) continue;

      const metrics = box.properties?.__vmprintTextMetrics;

      // Fallbacks for when metrics are not present (should not normally happen
      // for boxes with lines, but keeps the script defensive).
      const style = box.style || {};
      const fontSize = Number(style.fontSize ?? 12);
      const nominalLineHeight = fontSize * Number(style.lineHeight ?? 1.25);
      const borderLeft  = Number(style.borderLeftWidth  ?? style.borderWidth ?? 0);
      const paddingLeft = Number(style.paddingLeft ?? style.padding ?? 0);
      const borderTop   = Number(style.borderTopWidth   ?? style.borderWidth ?? 0);
      const paddingTop  = Number(style.paddingTop  ?? style.padding ?? 0);
      const fallbackContentX = box.x + borderLeft + paddingLeft;
      const fallbackContentY = box.y + borderTop  + paddingTop;

      const contentX = metrics?.contentBox.x ?? fallbackContentX;

      lines.forEach((line, li) => {
        const segScripts = line.map(seg => scriptOf(seg.text || ''));
        const scriptSet  = new Set(segScripts);

        // Skip lines that are entirely Latin — nothing interesting to annotate.
        if (scriptSet.size === 1 && scriptSet.has('latin')) return;

        const lineMeta = metrics?.lines[li];
        const lineTop  = lineMeta?.top      ?? (fallbackContentY + li * nominalLineHeight);
        const lineH    = lineMeta?.height   ?? nominalLineHeight;
        const baseline = lineMeta?.baseline ?? (lineTop + fontSize * 0.8);

        // Baseline rule when two or more scripts share the same line.
        if (scriptSet.size > 1) {
          const lineTextWidth = line.reduce((sum, seg) => sum + (seg.width || 0), 0);
          ctx.save();
          ctx.strokeColor('#ef4444').lineWidth(0.6).opacity(0.45);
          ctx.moveTo(contentX, baseline)
             .lineTo(contentX + lineTextWidth, baseline)
             .stroke();
          ctx.restore();
        }

        // Per-segment coloured fill band + underline bar.
        let segX = contentX;
        segScripts.forEach((script, si) => {
          const w     = line[si].width || 0;
          const color = SCRIPT_COLORS[script];

          if (color) {
            ctx.save();
            ctx.fillColor(color).opacity(0.14);
            ctx.rect(segX, lineTop, w, lineH).fill();
            ctx.restore();

            ctx.save();
            ctx.strokeColor(color).lineWidth(1.5).opacity(0.72);
            ctx.moveTo(segX, baseline + 1).lineTo(segX + w, baseline + 1).stroke();
            ctx.restore();
          }

          segX += w;
        });
      });
    }
  }
};
