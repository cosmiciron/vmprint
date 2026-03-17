/**
 * 02-text-layout-advanced.overlay.mjs
 *
 * Overlay:
 *   • Justified boxes → a hairline rule along the right edge of each non-final
 *     line, length proportional to how close the justification filled the measure.
 *   • Soft-hyphen boxes → small red tick marks at the right edge of lines that
 *     end with a visible hyphen character.
 *   • RTL boxes → a small "RTL ←" badge on the left margin.
 */
export default {
  overlay(page, ctx) {
    for (const box of page.boxes) {
      const style = box.style || {};
      const isJustified = style.textAlign === 'justify' && style.justifyEngine === 'advanced';
      const isSoftHyphen = style.hyphenation === 'soft';
      const isRtl = style.direction === 'rtl';

      if (!isJustified && !isSoftHyphen && !isRtl) continue;

      const lines = box.lines || [];
      const borderLeft = Number(style.borderLeftWidth ?? style.borderWidth ?? 0);
      const paddingLeft = Number(style.paddingLeft ?? style.padding ?? 0);
      const contentX = box.x + borderLeft + paddingLeft;
      const contentW = box.w;

      if (isJustified) {
        // Draw a fill-indicator rule on the right edge of each non-final line.
        let lineY = box.y;
        const lineHeight = Number(style.lineHeight ?? 1.25) * Number(style.fontSize ?? 12);
        lines.slice(0, -1).forEach((line, _i) => {
          const lineWidth = line.reduce((acc, seg) => acc + (seg.width || 0), 0);
          const fillRatio = Math.min(1, lineWidth / contentW);
          ctx.save();
          ctx.strokeColor('#6366f1').lineWidth(1).opacity(0.55);
          ctx.moveTo(contentX + lineWidth, lineY + lineHeight - 1)
             .lineTo(contentX + contentW, lineY + lineHeight - 1)
             .stroke();
          ctx.restore();
          lineY += lineHeight;
        });
      }

      if (isSoftHyphen) {
        // Draw a red tick where a soft-hyphen caused a visible break.
        let lineY = box.y;
        const lineHeight = Number(style.lineHeight ?? 1.25) * Number(style.fontSize ?? 12);
        lines.forEach((line) => {
          const lastSeg = line[line.length - 1];
          if (lastSeg && (lastSeg.text || '').endsWith('-')) {
            const lineWidth = line.reduce((acc, seg) => acc + (seg.width || 0), 0);
            ctx.save();
            ctx.strokeColor('#ef4444').lineWidth(1.5).opacity(0.8);
            ctx.moveTo(contentX + lineWidth + 1, lineY + 2)
               .lineTo(contentX + lineWidth + 1, lineY + lineHeight - 2)
               .stroke();
            ctx.restore();
          }
          lineY += lineHeight;
        });
      }

      if (isRtl) {
        ctx.save();
        ctx.fillColor('#b45309').opacity(0.8);
        ctx.font('Helvetica', 6);
        ctx.text('RTL ←', box.x - 28, box.y + 8);
        ctx.restore();
      }
    }
  }
};
