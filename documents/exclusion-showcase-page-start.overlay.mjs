const EXCLUSION = {
  x: 20,
  y: 20,
  w: 280,
  h: 42
};

export default {
  backdrop(page, ctx) {
    ctx.save();
    ctx.fillColor('#ef4444').opacity(0.12);
    ctx.rect(EXCLUSION.x, EXCLUSION.y, EXCLUSION.w, EXCLUSION.h).fill();

    ctx.strokeColor('#dc2626').lineWidth(0.8).dash(4, { space: 4 }).opacity(0.7);
    ctx.rect(EXCLUSION.x, EXCLUSION.y, EXCLUSION.w, EXCLUSION.h).stroke();
    ctx.undash();

    ctx.fillColor('#991b1b').opacity(0.9);
    ctx.font('Helvetica', 7);
    ctx.text('excluded band', EXCLUSION.x + 4, EXCLUSION.y + 6, {
      width: EXCLUSION.w - 8,
      align: 'left'
    });
    ctx.restore();
  }
};
