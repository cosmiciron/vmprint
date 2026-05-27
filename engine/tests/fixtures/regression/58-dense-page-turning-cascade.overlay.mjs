/**
 * 58-dense-page-turning-cascade.overlay.mjs
 *
 * Visual proof for a dense top-bottom cascade:
 * - Pages 1-2: label the carried blocker as a full-width vertical exclusion.
 * - Page 2: mark that no text is allowed in the blocked frame.
 * - Page 3: bracket the resumed body as the next full-width vertical zone.
 */

function textNoBreak(ctx, str, x, y, size = 6.5, color = "#334155", opacity = 0.9) {
  ctx.save();
  ctx.fillColor(color).opacity(opacity).font("Helvetica", size);
  ctx.text(str, x, y, { lineBreak: false });
  ctx.restore();
}

function pill(ctx, label, x, y, width, color) {
  ctx.save();
  ctx.fillColor(color).opacity(0.9);
  ctx.roundedRect(x, y, width, 12, 3).fill();
  ctx.fillColor("#ffffff").opacity(1).font("Helvetica-Bold", 6.5);
  ctx.text(label, x + 5, y + 3, { lineBreak: false });
  ctx.restore();
}

function drawBlockerLabel(ctx, box, pageIndex) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const title = pageIndex === 0
    ? "PRIMARY CONTAINER BLOCKED"
    : "BLOCKER CARRIES OVER";
  const note = pageIndex === 0
    ? "top-bottom obstacle occupies the frame"
    : "no text is placed in this page frame";

  ctx.save();
  ctx.fillColor("#0f172a").opacity(0.18);
  ctx.roundedRect(box.x + 18, cy - 19, box.w - 36, 38, 4).fill();
  ctx.strokeColor("#ffffff").lineWidth(0.6).dash(3, { space: 3 }).opacity(0.75);
  ctx.roundedRect(box.x + 18, cy - 19, box.w - 36, 38, 4).stroke();
  ctx.undash();
  ctx.restore();

  textNoBreak(ctx, title, cx - 80, cy - 9, 8.5, "#ffffff", 0.98);
  textNoBreak(ctx, note, cx - 78, cy + 4, 6.2, "#e0f2fe", 0.95);

  const badge = pageIndex === 0 ? "START" : "PAGE TURN";
  pill(ctx, badge, box.x + 6, box.y + 6, pageIndex === 0 ? 36 : 54, "#0f766e");
}

function drawLaneRules(ctx, leftEdge, rightEdge, yTop, yBottom, color = "#14b8a6") {
  ctx.save();
  ctx.strokeColor(color).lineWidth(0.7).dash(5, { space: 4 }).opacity(0.72);
  ctx.moveTo(leftEdge, yTop).lineTo(rightEdge, yTop).stroke();
  ctx.moveTo(leftEdge, yBottom).lineTo(rightEdge, yBottom).stroke();
  ctx.undash();
  ctx.restore();
}

function drawResumeZone(ctx, textBoxes, leftEdge, rightEdge) {
  if (!textBoxes.length) return;
  const top = Math.min(...textBoxes.map((box) => box.y));
  const bottom = Math.max(...textBoxes.map((box) => box.y + box.h));

  ctx.save();
  ctx.strokeColor("#16a34a").lineWidth(1).opacity(0.82);
  ctx.moveTo(leftEdge - 7, top).lineTo(leftEdge - 7, bottom).stroke();
  ctx.moveTo(leftEdge - 11, top).lineTo(leftEdge + 3, top).stroke();
  ctx.moveTo(leftEdge - 11, bottom).lineTo(leftEdge + 3, bottom).stroke();
  ctx.restore();

  pill(ctx, "NEXT AVAILABLE FULL-WIDTH ZONE", leftEdge, 10, 126, "#16a34a");
  drawLaneRules(ctx, leftEdge, rightEdge, top, bottom, "#16a34a");
}

export default {
  overlay(page, ctx) {
    const boxes = Array.isArray(page.boxes) ? page.boxes : [];
    if (!boxes.length) return;

    const leftEdge = boxes.reduce((min, box) => (box.x > 0 && box.x < min ? box.x : min), page.width);
    const rightEdge = page.width - leftEdge;
    const blocker = boxes.find((box) => box.meta?.sourceId === "author:primary-container-blocker");
    const textBoxes = boxes.filter((box) => Array.isArray(box.lines) && box.lines.length > 0 && box.type !== "h1");

    textNoBreak(ctx, `cascade frame ${page.index + 1}`, leftEdge, Math.max(8, leftEdge / 2), 6, "#64748b", 0.75);

    if (blocker) {
      drawLaneRules(ctx, leftEdge, rightEdge, blocker.y, blocker.y + blocker.h);
      drawBlockerLabel(ctx, blocker, page.index);
    }

    if (page.index === 1) {
      pill(ctx, "TEXT SKIPS THIS FRAME", leftEdge + 70, page.height - leftEdge - 16, 92, "#dc2626");
    }

    if (!blocker && textBoxes.length > 0) {
      drawResumeZone(ctx, textBoxes, leftEdge, rightEdge);
    }
  }
};
