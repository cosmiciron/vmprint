/**
 * 10-packager-split-scenarios.overlay.mjs
 *
 * Visual diagnostics for the Packager — the layer that decides when to
 * slice, where to cut, and what state carries forward.  All marks live
 * in the page margins or as non-text overlay tints.
 *
 *   Box-type tints      — subtle fill per element type:
 *                          indigo = h1/h2,  amber = note,  rose = split-marker
 *   Table grid          — emerald dotted verticals at column boundaries and
 *                          dotted horizontals at every row boundary (the
 *                          Packager's candidate merge/split points); column-
 *                          width dimension callouts above the first visible row.
 *   Table header badge  — "HDR" on the original header row; "RH" on
 *                          engine-repeated header rows on continuation pages.
 *   Fragment seam+badge — teal dashed seam at the top of every continuation
 *                          box; navy "F{n}" pill in the left margin.
 *   Line-count labels   — "NL" in the right margin:
 *                          indigo = first-frag side, teal = continuation side.
 *   Split-marker pip    — small amber dot in the left margin.
 *   KWN chain bracket   — violet bracket in the left margin spanning every
 *                          member of a keep-with-next group (the Packager's
 *                          indivisible unit), with a "KWN" label.
 *   KWN chevron         — downward "v" in the right margin per kept box.
 *   Split-origin mark   — rose hairline 2pt below the last box of a split
 *                          fragment; a labelled pill names the strategy
 *                          ("KWN split" / "pg-top split").
 *   Content-area outline— faint dashed rect showing the Packager's frame.
 *   Page header         — page-number label in the top gutter on pages 2+.
 *   Legend              — compact key on page 1, bottom-right of content area.
 */
export default {
  overlay(page, ctx) {
    const boxes = page.boxes;

    const LEFT_EDGE = boxes.reduce(
      (min, b) => (b.x > 0 && b.x < min ? b.x : min),
      page.width
    );
    const RIGHT_EDGE = page.width - LEFT_EDGE;

    // ── Pre-pass A: split-marker detection ───────────────────────────────────
    const firstFragIdx = new Set();
    boxes.forEach((box, i) => {
      if (box.type === 'split-marker' && i > 0) firstFragIdx.add(i - 1);
    });

    // ── Pre-pass B: keep-with-next chain detection ────────────────────────────
    // A chain: maximal run of keepWithNext=true boxes + their anchor box.
    const kwnChains = [];
    let chainStart = -1;
    boxes.forEach((box, i) => {
      if (box.style?.keepWithNext === true) {
        if (chainStart === -1) chainStart = i;
      } else {
        if (chainStart !== -1) {
          kwnChains.push({ start: chainStart, end: i });
          chainStart = -1;
        }
      }
    });
    if (chainStart !== -1) {
      kwnChains.push({ start: chainStart, end: Math.min(chainStart + 1, boxes.length - 1) });
    }

    // ── Pre-pass C: table structure ───────────────────────────────────────────
    const tableCells = boxes.filter(b => b.type === 'table-cell');
    let tableInfo = null;
    if (tableCells.length > 0) {
      const allX   = tableCells.map(c => c.x);
      const allY   = tableCells.map(c => c.y);
      const tableX = Math.min(...allX);
      const tableR = Math.max(...tableCells.map(c => c.x + c.w));
      const minY   = Math.min(...allY);
      const maxY   = Math.max(...tableCells.map(c => c.y + c.h));

      // Unique sorted column-left-x values → column descriptors
      const colXs = [...new Set(allX)].sort((a, b) => a - b);
      const cols  = colXs.map(x => ({ x, w: (tableCells.find(c => c.x === x) ?? {}).w ?? 0 }));

      // Unique sorted row-top-y values (for horizontal grid lines)
      const rowYs = [...new Set(allY)].sort((a, b) => a - b);

      // Top-row cells (smallest y)
      const topRowCells = tableCells.filter(c => c.y === minY);

      // Is the table's first visible row a repeated header?
      const firstCellIdx    = boxes.indexOf(tableCells[0]);
      const hasLeadingMarker = boxes.slice(0, firstCellIdx).some(b => b.type === 'split-marker');
      const topRowGenerated  = topRowCells.some(c => c.meta?.generated === true);
      const isRepeatHeader   = hasLeadingMarker || topRowGenerated;

      tableInfo = { cols, rowYs, tableX, tableR, minY, maxY, topRowCells, isRepeatHeader };
    }

    // ── Legend (page 1 only) ──────────────────────────────────────────────────
    if (page.index === 0) {
      const ROW_H = 9;
      const ROWS  = 7;
      const lw    = 152;
      const lh    = ROWS * ROW_H + 16;
      const lx    = RIGHT_EDGE - lw;
      const ly    = page.height - LEFT_EDGE - lh;

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
      ctx.moveTo(lx, ly + 12).lineTo(lx + lw, ly + 12).stroke();
      ctx.restore();

      const ICON_X = lx + 4;
      const DESC_X = lx + 28;

      const legendText = (str, x, y, color, opacity = 0.85) => {
        ctx.save();
        ctx.fillColor(color).opacity(opacity);
        ctx.font('Helvetica', 5.5);
        ctx.text(str, x, y, { lineBreak: false });
        ctx.restore();
      };

      const row = i => ({
        iconY: ly + 16 + i * ROW_H + ROW_H / 2,
        descY: ly + 16 + i * ROW_H + 1,
      });

      // Row 0 — box-type tints
      {
        const { descY } = row(0);
        ctx.save();
        ctx.fillColor('#c7d2fe').opacity(0.55); ctx.rect(ICON_X,      descY, 7, 7).fill();
        ctx.fillColor('#fde68a').opacity(0.65); ctx.rect(ICON_X +  9, descY, 7, 7).fill();
        ctx.fillColor('#fda4af').opacity(0.70); ctx.rect(ICON_X + 18, descY, 7, 7).fill();
        ctx.restore();
        legendText('box type: h2 / note / split-marker', DESC_X, descY, '#374151');
      }

      // Row 1 — table grid
      {
        const { iconY, descY } = row(1);
        ctx.save();
        ctx.strokeColor('#10b981').lineWidth(0.5).dash(2, { space: 3 }).opacity(0.65);
        ctx.moveTo(ICON_X + 7, iconY - 4).lineTo(ICON_X + 7, iconY + 4).stroke();
        ctx.moveTo(ICON_X + 14, iconY - 4).lineTo(ICON_X + 14, iconY + 4).stroke();
        ctx.moveTo(ICON_X + 2, iconY).lineTo(ICON_X + 20, iconY).stroke();
        ctx.undash();
        ctx.restore();
        legendText('table row / column structure', DESC_X, descY, '#374151');
      }

      // Row 2 — fragment badge + seam
      {
        const { iconY, descY } = row(2);
        ctx.save();
        ctx.fillColor('#0f4c81').opacity(0.85);
        ctx.roundedRect(ICON_X, iconY - 5, 14, 9, 2).fill();
        ctx.fillColor('#ffffff').opacity(1);
        ctx.font('Helvetica', 5.5);
        ctx.text('F1', ICON_X + 3, iconY - 3.5, { lineBreak: false });
        ctx.restore();
        ctx.save();
        ctx.strokeColor('#0d9488').lineWidth(0.9).dash(3, { space: 2 }).opacity(0.8);
        ctx.moveTo(ICON_X + 16, iconY).lineTo(ICON_X + 24, iconY).stroke();
        ctx.undash();
        ctx.restore();
        legendText('continuation fragment + seam', DESC_X, descY, '#374151');
      }

      // Row 3 — line count
      {
        const { descY } = row(3);
        legendText('5L', ICON_X + 1, descY, '#0d9488');
        legendText('4L', ICON_X + 14, descY, '#6366f1');
        legendText('line count — cont. / first-frag side', DESC_X, descY, '#374151');
      }

      // Row 4 — split-marker pip
      {
        const { iconY, descY } = row(4);
        ctx.save();
        ctx.fillColor('#f59e0b').opacity(0.85);
        ctx.roundedRect(ICON_X + 4, iconY - 3, 6, 6, 3).fill();
        ctx.restore();
        legendText('split-marker injected label', DESC_X, descY, '#374151');
      }

      // Row 5 — KWN bracket
      {
        const { iconY, descY } = row(5);
        ctx.save();
        ctx.strokeColor('#8b5cf6').lineWidth(1.2).opacity(0.7);
        ctx.moveTo(ICON_X + 10, iconY - 4).lineTo(ICON_X + 10, iconY + 4).stroke();
        ctx.moveTo(ICON_X + 10, iconY - 4).lineTo(ICON_X + 14, iconY - 4).stroke();
        ctx.moveTo(ICON_X + 10, iconY + 4).lineTo(ICON_X + 14, iconY + 4).stroke();
        ctx.restore();
        legendText('keep-with-next chain (Packager unit)', DESC_X, descY, '#374151');
      }

      // Row 6 — split-origin hairline
      {
        const { iconY, descY } = row(6);
        ctx.save();
        ctx.strokeColor('#ec4899').lineWidth(0.7).opacity(0.55);
        ctx.moveTo(ICON_X, iconY).lineTo(ICON_X + 20, iconY).stroke();
        ctx.restore();
        legendText('split origin (Packager cut point)', DESC_X, descY, '#374151');
      }
    }

    // ── Page header (pages 2+) ────────────────────────────────────────────────
    if (page.index > 0) {
      const gutterMid = LEFT_EDGE / 2;
      ctx.save();
      ctx.strokeColor('#cbd5e1').lineWidth(0.4).opacity(0.7);
      ctx.moveTo(LEFT_EDGE, gutterMid + 4).lineTo(RIGHT_EDGE, gutterMid + 4).stroke();
      ctx.fillColor('#94a3b8').opacity(0.7);
      ctx.font('Helvetica', 6);
      ctx.text(`page ${page.index + 1}`, LEFT_EDGE, gutterMid, { lineBreak: false });
      ctx.restore();
    }

    // ── Content-area outline ──────────────────────────────────────────────────
    ctx.save();
    ctx.strokeColor('#94a3b8').lineWidth(0.3).dash(5, { space: 5 }).opacity(0.15);
    ctx.rect(LEFT_EDGE, LEFT_EDGE, RIGHT_EDGE - LEFT_EDGE, page.height - 2 * LEFT_EDGE).stroke();
    ctx.undash();
    ctx.restore();

    // ── Per-box annotations ───────────────────────────────────────────────────
    boxes.forEach((box, bi) => {
      const isContinuation = box.meta?.isContinuation === true;
      const fragIndex      = Number(box.meta?.fragmentIndex ?? 0);
      const isSplitMarker  = box.type === 'split-marker';
      const isTableCell    = box.type === 'table-cell';
      const lineCount      = box.lines?.length ?? 0;
      const isFirstFrag    = firstFragIdx.has(bi);
      const isCont         = !isSplitMarker && (isContinuation || fragIndex > 0);
      const kwn            = box.style?.keepWithNext === true;
      const sourceId       = String(box.meta?.sourceId ?? box.meta?.originSourceId ?? '');

      // 1. Box-type tint
      const TYPE_TINTS = {
        h1:             ['#c7d2fe', 0.12],
        h2:             ['#c7d2fe', 0.12],
        note:           ['#fde68a', 0.18],
        'split-marker': ['#fda4af', 0.20],
      };
      const tint = TYPE_TINTS[box.type];
      if (tint) {
        ctx.save();
        ctx.fillColor(tint[0]).opacity(tint[1]);
        ctx.rect(box.x, box.y, box.w, box.h).fill();
        ctx.restore();
      }

      // 2. Fragment seam + F-badge
      if (isCont) {
        ctx.save();
        ctx.strokeColor('#0d9488').lineWidth(0.9).dash(3, { space: 2 }).opacity(0.8);
        ctx.moveTo(box.x, box.y).lineTo(box.x + box.w, box.y).stroke();
        ctx.undash();
        ctx.restore();

        const bw = 20, bh = 11;
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

      // 3. Line count in right margin (skip table cells — too many per row)
      if (lineCount > 0 && (isFirstFrag || isCont) && !isTableCell) {
        const color = isCont ? '#0d9488' : '#6366f1';
        ctx.save();
        ctx.fillColor(color).opacity(0.85);
        ctx.font('Helvetica', 6.5);
        ctx.text(`${lineCount}L`, RIGHT_EDGE + 4, box.y + 2, { lineBreak: false });
        ctx.restore();
      }

      // 4. Split-marker pip
      if (isSplitMarker) {
        ctx.save();
        ctx.fillColor('#f59e0b').opacity(0.85);
        ctx.roundedRect(LEFT_EDGE - 8, box.y + box.h / 2 - 3, 6, 6, 3).fill();
        ctx.restore();
      }

      // 5. KWN per-box chevron in right margin
      if (kwn) {
        const cx = RIGHT_EDGE + 6;
        const cy = box.y + box.h - 3;
        ctx.save();
        ctx.strokeColor('#8b5cf6').lineWidth(1.2).opacity(0.7);
        ctx.moveTo(cx, cy - 4).lineTo(cx + 5, cy).lineTo(cx + 10, cy - 4).stroke();
        ctx.restore();
      }

      // 6. Split-origin hairline + scenario label (text boxes only)
      if (isFirstFrag && !isTableCell && !isSplitMarker) {
        ctx.save();
        ctx.strokeColor('#ec4899').lineWidth(0.7).opacity(0.55);
        ctx.moveTo(box.x, box.y + box.h + 2).lineTo(box.x + box.w, box.y + box.h + 2).stroke();
        ctx.restore();

        const SCENARIO_LABELS = {
          'keep-split':     'KWN split',
          'page-top-split': 'pg-top split',
        };
        const scenLabel = SCENARIO_LABELS[sourceId];
        if (scenLabel) {
          const sw = Math.ceil(scenLabel.length * 3.2 + 10);
          const sh = 8;
          const sx = box.x + box.w - sw - 3;
          const sy = box.y + box.h - sh - 3;
          ctx.save();
          ctx.fillColor('#ec4899').opacity(0.60);
          ctx.roundedRect(sx, sy, sw, sh, 2).fill();
          ctx.fillColor('#ffffff').opacity(1);
          ctx.font('Helvetica', 5.5);
          ctx.text(scenLabel, sx + 4, sy + 1.5, { lineBreak: false });
          ctx.restore();
        }
      }

      // 7. Table header badge
      if (isTableCell && tableInfo?.topRowCells.includes(box)) {
        const label = tableInfo.isRepeatHeader ? 'RH' : 'HDR';
        const color = tableInfo.isRepeatHeader ? '#0ea5e9' : '#0f4c81';
        const pw = 18, ph = 8;
        ctx.save();
        ctx.fillColor(color).opacity(0.70);
        ctx.roundedRect(box.x + box.w - pw - 2, box.y + 1, pw, ph, 2).fill();
        ctx.fillColor('#ffffff').opacity(1);
        ctx.font('Helvetica', 5);
        ctx.text(label, box.x + box.w - pw + 2, box.y + 2, { lineBreak: false });
        ctx.restore();
      }
    });

    // ── Post-pass: KWN chain brackets (left margin) ───────────────────────────
    kwnChains.forEach(({ start, end }) => {
      const topBox = boxes[start];
      const botBox = boxes[end];
      if (!topBox || !botBox) return;

      const top = topBox.y;
      const bot = botBox.y + botBox.h;
      const bx  = LEFT_EDGE - 5;

      ctx.save();
      ctx.strokeColor('#8b5cf6').lineWidth(1.2).opacity(0.75);
      ctx.moveTo(bx, top).lineTo(bx, bot).stroke();
      ctx.moveTo(bx, top).lineTo(bx + 4, top).stroke();  // top serif (toward content)
      ctx.moveTo(bx, bot).lineTo(bx + 4, bot).stroke();  // bottom serif
      ctx.restore();

      ctx.save();
      ctx.fillColor('#8b5cf6').opacity(0.80);
      ctx.font('Helvetica', 5.5);
      ctx.text('KWN', bx - 18, (top + bot) / 2 - 3, { lineBreak: false });
      ctx.restore();
    });

    // ── Post-pass: table column + row grid ────────────────────────────────────
    if (tableInfo) {
      const { cols, rowYs, tableX, tableR, minY, maxY } = tableInfo;

      // Vertical column-boundary lines (between columns, plus right edge)
      cols.forEach((col, ci) => {
        if (ci > 0) {
          ctx.save();
          ctx.strokeColor('#10b981').lineWidth(0.4).dash(2, { space: 3 }).opacity(0.40);
          ctx.moveTo(col.x, minY).lineTo(col.x, maxY).stroke();
          ctx.undash();
          ctx.restore();
        }
      });
      if (cols.length > 0) {
        const lastCol = cols[cols.length - 1];
        ctx.save();
        ctx.strokeColor('#10b981').lineWidth(0.4).dash(2, { space: 3 }).opacity(0.40);
        ctx.moveTo(lastCol.x + lastCol.w, minY).lineTo(lastCol.x + lastCol.w, maxY).stroke();
        ctx.undash();
        ctx.restore();
      }

      // Horizontal row-boundary lines (between rows — the candidate split points)
      rowYs.slice(1).forEach(y => {
        ctx.save();
        ctx.strokeColor('#10b981').lineWidth(0.3).dash(2, { space: 4 }).opacity(0.28);
        ctx.moveTo(tableX, y).lineTo(tableR, y).stroke();
        ctx.undash();
        ctx.restore();
      });

      // Column-width callouts above the first visible row
      const calloutY = minY - 14;
      if (calloutY >= 8) {
        cols.forEach(col => {
          const wLabel = `${Math.round(col.w)}pt`;
          const midX   = col.x + col.w / 2;

          ctx.save();
          ctx.strokeColor('#10b981').lineWidth(0.4).opacity(0.55);
          ctx.moveTo(col.x,       calloutY + 4).lineTo(col.x + col.w, calloutY + 4).stroke();
          ctx.moveTo(col.x,       calloutY + 2).lineTo(col.x,         calloutY + 6).stroke();
          ctx.moveTo(col.x + col.w, calloutY + 2).lineTo(col.x + col.w, calloutY + 6).stroke();
          ctx.restore();

          ctx.save();
          ctx.fillColor('#10b981').opacity(0.70);
          ctx.font('Helvetica', 5);
          ctx.text(wLabel, midX - wLabel.length * 1.5, calloutY - 2, { lineBreak: false });
          ctx.restore();
        });
      }
    }
  },
};
