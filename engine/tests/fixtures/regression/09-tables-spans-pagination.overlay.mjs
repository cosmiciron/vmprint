/**
 * 09-tables-spans-pagination.overlay.mjs
 *
 * Backdrop: faint alternating-column fill stripes.
 * Overlay: tiny r,c coordinate labels in each table_cell box;
 *          colSpan>1 cells tinted light blue, rowSpan>1 cells tinted light green.
 */
export default {
  backdrop(page, ctx) {
    // Derive column x-positions from table_cell boxes on the first page
    const cellBoxes = page.boxes.filter(b => b.type === 'table_cell');
    if (!cellBoxes.length) return;

    // Collect unique x positions to approximate column starts
    const xSet = new Set(cellBoxes.map(b => Math.round(b.x)));
    const xPositions = Array.from(xSet).sort((a, z) => a - z);

    // Build column stripes using average cell width
    const avgW = cellBoxes.reduce((s, b) => s + b.w, 0) / cellBoxes.length;
    xPositions.forEach((xStart, i) => {
      if (i % 2 === 0) return; // only odd columns
      ctx.save();
      ctx.fillColor('#f8fafc').opacity(0.5);
      ctx.rect(xStart, 0, avgW, page.height).fill();
      ctx.restore();
    });
  },

  overlay(page, ctx) {
    for (const box of page.boxes) {
      if (box.type !== 'table_cell') continue;

      const rowIndex  = box.properties?._tableRowIndex  ?? box.meta?.rowIndex  ?? '?';
      const colStart  = box.properties?._tableColStart  ?? box.meta?.colStart  ?? '?';
      const colSpan   = Number(box.properties?._tableColSpan ?? box.meta?.colSpan ?? 1);
      const rowSpan   = Number(box.properties?._tableRowSpan ?? box.meta?.rowSpan ?? 1);

      // Tint colspan cells blue, rowspan cells green
      if (colSpan > 1) {
        ctx.save();
        ctx.fillColor('#bfdbfe').opacity(0.25);
        ctx.rect(box.x, box.y, box.w, box.h).fill();
        ctx.restore();
      } else if (rowSpan > 1) {
        ctx.save();
        ctx.fillColor('#bbf7d0').opacity(0.25);
        ctx.rect(box.x, box.y, box.w, box.h).fill();
        ctx.restore();
      }

      // Box outline
      ctx.save();
      ctx.strokeColor('#cbd5e1').lineWidth(0.4).opacity(0.6);
      ctx.rect(box.x, box.y, box.w, box.h).stroke();
      ctx.restore();

      // Coordinate label at top-left corner
      const label = `r${rowIndex},c${colStart}`;
      ctx.save();
      ctx.fillColor('#475569').opacity(0.8);
      ctx.font('Helvetica', 5.5);
      ctx.text(label, box.x + 1.5, box.y + 5.5);
      ctx.restore();

      // Span annotation if either span > 1
      if (colSpan > 1 || rowSpan > 1) {
        const spanLabel = [
          colSpan > 1 ? `cs${colSpan}` : '',
          rowSpan > 1 ? `rs${rowSpan}` : ''
        ].filter(Boolean).join(' ');
        ctx.save();
        ctx.fillColor('#1e40af').opacity(0.7);
        ctx.font('Helvetica', 5.5);
        ctx.text(spanLabel, box.x + 1.5, box.y + box.h - 2);
        ctx.restore();
      }
    }
  }
};
