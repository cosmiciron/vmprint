const NAVY = "#17345d";
const TEAL = "#0f766e";
const GOLD = "#a16207";
const RED = "#b42318";
const INK = "#334155";

const PAGE_WIDTH = 595.28; // A4 portrait
const PAGE_HEIGHT = 841.89;
const MARGINS = { top: 36, right: 45, bottom: 48, left: 45 };

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function label(ctx, x, y, text, color = INK, size = 5.5, opacity = 0.82) {
  ctx.save();
  ctx.font("Helvetica", size).fillColor(color).opacity(opacity);
  ctx.text(text, x, y, { lineBreak: false });
  ctx.restore();
}

function labelBold(ctx, x, y, text, color = INK, size = 6, opacity = 0.88) {
  ctx.save();
  ctx.font("Helvetica-Bold", size).fillColor(color).opacity(opacity);
  ctx.text(text, x, y, { lineBreak: false });
  ctx.restore();
}

function dashedRect(ctx, x, y, w, h, color, opacity = 0.55) {
  if (!(w > 0 && h > 0)) return;
  ctx.save();
  ctx.strokeColor(color).lineWidth(0.5).opacity(opacity).dash(3, { space: 2 });
  ctx.rect(x, y, w, h).stroke().undash();
  ctx.restore();
}

function fillRect(ctx, x, y, w, h, color, opacity = 0.08) {
  if (!(w > 0 && h > 0)) return;
  ctx.save();
  ctx.fillColor(color).opacity(opacity).rect(x, y, w, h).fill();
  ctx.restore();
}

function hDim(ctx, x1, x2, y, text, color = INK) {
  ctx.save();
  ctx.strokeColor(color).lineWidth(0.35).opacity(0.5);
  ctx.moveTo(x1, y).lineTo(x2, y).stroke();
  ctx.moveTo(x1, y - 4).lineTo(x1, y + 4).stroke();
  ctx.moveTo(x2, y - 4).lineTo(x2, y + 4).stroke();
  ctx.restore();
  label(ctx, (x1 + x2) / 2 - text.length * 1.5, y - 8, text, color, 4.8, 0.72);
}

function vDim(ctx, x, y1, y2, text, color = INK) {
  ctx.save();
  ctx.strokeColor(color).lineWidth(0.35).opacity(0.5);
  ctx.moveTo(x, y1).lineTo(x, y2).stroke();
  ctx.moveTo(x - 4, y1).lineTo(x + 4, y1).stroke();
  ctx.moveTo(x - 4, y2).lineTo(x + 4, y2).stroke();
  ctx.restore();
  ctx.save();
  ctx.translate(x - 7, (y1 + y2) / 2);
  ctx.rotate(-90);
  ctx.font("Helvetica", 4.8).fillColor(color).opacity(0.72);
  ctx.text(text, -text.length * 1.4, 0, { lineBreak: false });
  ctx.restore();
}

function isFooterBox(box) {
  return box.type === "footer-left" || box.type === "footer-page" || box.type === "footer-right";
}

function bounds(boxes) {
  if (!boxes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    const x = n(box.x);
    const y = n(box.y);
    const w = n(box.w);
    const h = n(box.h);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, maxY };
}

function drawPageFrame(page, ctx) {
  const contentW = PAGE_WIDTH - MARGINS.left - MARGINS.right;
  const contentH = PAGE_HEIGHT - MARGINS.top - MARGINS.bottom;
  dashedRect(ctx, MARGINS.left, MARGINS.top, contentW, contentH, NAVY, 0.18);
  label(ctx, MARGINS.left + 2, MARGINS.top - 11, `content frame ${contentW.toFixed(0)} × ${contentH.toFixed(0)} pt`, NAVY, 5, 0.5);
  label(ctx, MARGINS.left + 2, MARGINS.top - 3, `page ${page.index + 1}`, NAVY, 5, 0.5);
}

function drawPage1(page, ctx) {
  const nonFooter = page.boxes.filter((box) => !isFooterBox(box));
  const heroBounds = bounds(nonFooter);
  const footerTop = PAGE_HEIGHT - MARGINS.bottom;
  if (!heroBounds) return;

  const remainingY = heroBounds.maxY;
  const remainingH = footerTop - remainingY;
  fillRect(ctx, MARGINS.left, remainingY, PAGE_WIDTH - MARGINS.left - MARGINS.right, remainingH, GOLD, 0.08);
  dashedRect(ctx, MARGINS.left, remainingY, PAGE_WIDTH - MARGINS.left - MARGINS.right, remainingH, GOLD, 0.55);
  labelBold(ctx, MARGINS.left + 6, remainingY + 6, "PAGE 1 REMAINING BODY AREA", GOLD);
  label(ctx, MARGINS.left + 6, remainingY + 15, `${(PAGE_WIDTH - MARGINS.left - MARGINS.right).toFixed(0)} × ${remainingH.toFixed(1)} pt available after hero package`, GOLD, 5);
  vDim(ctx, PAGE_WIDTH - MARGINS.right + 14, remainingY, footerTop, `${remainingH.toFixed(1)} pt`, GOLD);
}

function drawPage2(page, ctx) {
  const nonFooter = page.boxes.filter((box) => !isFooterBox(box));
  const zoneBounds = bounds(nonFooter);
  if (!zoneBounds) return;

  const splitX = 383;
  const gutter = 18;
  const mainBoxes = nonFooter.filter((box) => n(box.x) < splitX);
  const sideBoxes = nonFooter.filter((box) => n(box.x) >= splitX);
  const mainBounds = bounds(mainBoxes);
  const sideBounds = bounds(sideBoxes);

  fillRect(ctx, zoneBounds.x, zoneBounds.y, zoneBounds.w, zoneBounds.h, RED, 0.045);
  dashedRect(ctx, zoneBounds.x, zoneBounds.y, zoneBounds.w, zoneBounds.h, RED, 0.55);
  labelBold(ctx, zoneBounds.x + 6, zoneBounds.y - 13, "ZONE-MAP FOOTPRINT", RED);
  label(ctx, zoneBounds.x + 6, zoneBounds.y - 5, `${zoneBounds.w.toFixed(1)} × ${zoneBounds.h.toFixed(1)} pt required`, RED, 5);

  if (mainBounds) {
    fillRect(ctx, mainBounds.x, mainBounds.y, mainBounds.w, mainBounds.h, TEAL, 0.06);
    dashedRect(ctx, mainBounds.x, mainBounds.y, mainBounds.w, mainBounds.h, TEAL, 0.6);
    labelBold(ctx, mainBounds.x + 6, mainBounds.y + 6, "MAIN ZONE", TEAL);
    label(ctx, mainBounds.x + 6, mainBounds.y + 15, `${mainBounds.w.toFixed(1)} × ${mainBounds.h.toFixed(1)} pt`, TEAL, 5);

    const columnCount = 2;
    const columnW = (mainBounds.w - gutter) / columnCount;
    for (let i = 1; i < columnCount; i += 1) {
      const x = mainBounds.x + columnW * i + gutter * (i - 0.5);
      ctx.save();
      ctx.strokeColor(TEAL).lineWidth(0.3).opacity(0.4).dash(1.2, { space: 3.5 });
      ctx.moveTo(x, mainBounds.y).lineTo(x, mainBounds.y + mainBounds.h).stroke().undash();
      ctx.restore();
    }
    hDim(ctx, mainBounds.x, mainBounds.x + columnW, mainBounds.y - 16, `${columnW.toFixed(1)} pt col`, TEAL);
    hDim(ctx, mainBounds.x + columnW, mainBounds.x + columnW + gutter, mainBounds.y - 6, `${gutter.toFixed(0)} pt gutter`, TEAL);
  }

  if (sideBounds) {
    fillRect(ctx, sideBounds.x, sideBounds.y, sideBounds.w, sideBounds.h, NAVY, 0.055);
    dashedRect(ctx, sideBounds.x, sideBounds.y, sideBounds.w, sideBounds.h, NAVY, 0.6);
    labelBold(ctx, sideBounds.x + 6, sideBounds.y + 6, "SIDEBAR ZONE", NAVY);
    label(ctx, sideBounds.x + 6, sideBounds.y + 15, `${sideBounds.w.toFixed(1)} × ${sideBounds.h.toFixed(1)} pt`, NAVY, 5);
  }

  const obstacle = mainBoxes.find((box) => box.type === "obstacleImg");
  if (obstacle) {
    const x = n(obstacle.x);
    const y = n(obstacle.y);
    const w = n(obstacle.w);
    const h = n(obstacle.h);
    fillRect(ctx, x, y, w + 8, h, GOLD, 0.08);
    dashedRect(ctx, x, y, w + 8, h, GOLD, 0.65);
    label(ctx, x + 4, y - 10, `float exclusion ${(w + 8).toFixed(0)} × ${h.toFixed(0)} pt`, GOLD, 4.8, 0.8);
  }
}

export default {
  backdrop(page, ctx) {
    drawPageFrame(page, ctx);
  },

  overlay(page, ctx) {
    if (page.index === 0) drawPage1(page, ctx);
    if (page.index === 1) drawPage2(page, ctx);
  }
};
