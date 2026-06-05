/**
 * 59-parallel-sidebar-during-cascade.overlay.mjs
 *
 * Visual proof that parallel regional actors progress independently:
 * the main lane is blocked on frames 1-2, while the sidebar lane keeps filling.
 */

function textNoBreak(ctx, str, x, y, size = 6.2, color = "#334155", opacity = 0.9) {
  ctx.save();
  ctx.fillColor(color).opacity(opacity).font("Helvetica", size);
  ctx.text(str, x, y, { lineBreak: false });
  ctx.restore();
}

function pill(ctx, label, x, y, width, color) {
  ctx.save();
  ctx.fillColor(color).opacity(0.9);
  ctx.roundedRect(x, y, width, 11, 3).fill();
  ctx.fillColor("#ffffff").opacity(1).font("Helvetica-Bold", 5.8);
  ctx.text(label, x + 4, y + 3, { lineBreak: false });
  ctx.restore();
}

function sourceId(box) {
  return String(box?.meta?.sourceId || "");
}

export default {
  overlay(page, ctx) {
    const boxes = Array.isArray(page.boxes) ? page.boxes : [];
    if (!boxes.length) return;

    const leftEdge = boxes.reduce((min, box) => (box.x > 0 && box.x < min ? box.x : min), page.width);
    const rightEdge = page.width - leftEdge;
    const sidebarLeft = boxes
      .filter((box) => sourceId(box).includes("parallel-sidebar"))
      .reduce((min, box) => Math.min(min, box.x), Number.POSITIVE_INFINITY);
    const mainRight = Number.isFinite(sidebarLeft) ? sidebarLeft - 12 : rightEdge;

    textNoBreak(ctx, `parallel frame ${page.index + 1}`, leftEdge, 10, 6, "#64748b", 0.75);

    const blocker = boxes.find((box) =>
      sourceId(box).endsWith(":main-container-blocker-a")
      || sourceId(box).endsWith(":main-container-blocker-b")
    );
    if (blocker) {
      ctx.save();
      ctx.strokeColor("#14b8a6").lineWidth(0.8).dash(4, { space: 3 }).opacity(0.75);
      ctx.rect(blocker.x, blocker.y, blocker.w, blocker.h).stroke();
      ctx.undash();
      ctx.restore();
      pill(ctx, page.index === 0 ? "MAIN BLOCKED 1/2" : "MAIN BLOCKED 2/2", blocker.x + 5, blocker.y + 5, 76, "#0f766e");
    }

    const sidebarBoxes = boxes.filter((box) => sourceId(box).includes("parallel-sidebar"));
    if (sidebarBoxes.length > 0) {
      const top = Math.min(...sidebarBoxes.map((box) => box.y));
      const bottom = Math.max(...sidebarBoxes.map((box) => box.y + box.h));
      const left = Math.min(...sidebarBoxes.map((box) => box.x));
      const right = Math.max(...sidebarBoxes.map((box) => box.x + box.w));
      ctx.save();
      ctx.fillColor("#2563eb").opacity(0.045);
      ctx.rect(left - 4, top - 4, right - left + 8, bottom - top + 8).fill();
      ctx.strokeColor("#2563eb").lineWidth(0.7).dash(3, { space: 3 }).opacity(0.55);
      ctx.rect(left - 4, top - 4, right - left + 8, bottom - top + 8).stroke();
      ctx.undash();
      ctx.restore();
      pill(ctx, "SIDEBAR KEEPS RUNNING", left - 2, Math.max(10, top - 16), 93, "#2563eb");
    }

    const mainResume = boxes.find((box) => sourceId(box).endsWith(":main-after-cascade"));
    if (mainResume) {
      ctx.save();
      ctx.strokeColor("#16a34a").lineWidth(0.9).opacity(0.8);
      ctx.moveTo(leftEdge, mainResume.y).lineTo(mainRight, mainResume.y).stroke();
      ctx.restore();
      pill(ctx, "MAIN RESUMES", leftEdge, Math.max(10, mainResume.y - 15), 62, "#16a34a");
    }
  }
};
