const LEFT_EXCLUSION = {
  x: 20,
  y: 20,
  w: 70,
  h: 45
};

const RIGHT_EXCLUSION = {
  x: 230,
  y: 20,
  w: 70,
  h: 45
};

function drawExclusion(ctx, region, label) {
  ctx.save();
  ctx.fillColor('#ef4444').opacity(0.12);
  ctx.rect(region.x, region.y, region.w, region.h).fill();

  ctx.strokeColor('#dc2626').lineWidth(0.8).dash(4, { space: 4 }).opacity(0.7);
  ctx.rect(region.x, region.y, region.w, region.h).stroke();
  ctx.undash();

  ctx.fillColor('#991b1b').opacity(0.9);
  ctx.font('Helvetica', 7);
  ctx.text(label, region.x + 4, region.y + 6, {
    width: region.w - 8,
    align: 'left'
  });
  ctx.restore();
}

export default {
  backdrop(page, ctx) {
    if (page.index !== 0) return;

    drawExclusion(ctx, LEFT_EXCLUSION, 'left exclusion');
    drawExclusion(ctx, RIGHT_EXCLUSION, 'right exclusion');

    ctx.save();
    ctx.strokeColor('#2563eb').lineWidth(0.8).dash(3, { space: 3 }).opacity(0.8);
    ctx.rect(LEFT_EXCLUSION.x + LEFT_EXCLUSION.w, LEFT_EXCLUSION.y, RIGHT_EXCLUSION.x - (LEFT_EXCLUSION.x + LEFT_EXCLUSION.w), LEFT_EXCLUSION.h).stroke();
    ctx.undash();
    ctx.fillColor('#1d4ed8').opacity(0.9);
    ctx.font('Helvetica', 7);
    ctx.text('resolved content lane', 95, 26, {
      width: 130,
      align: 'center'
    });
    ctx.restore();
  }
};
