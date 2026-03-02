export default {
    overlay(page, ctx) {
        const inset = 18;
        const x = inset;
        const y = inset;
        const w = Math.max(0, page.width - inset * 2);
        const h = Math.max(0, page.height - inset * 2);

        ctx.save();
        ctx.strokeColor('#22c55e').lineWidth(1.2).dash(8, { space: 4 }).opacity(0.8);
        ctx.rect(x, y, w, h).stroke();
        ctx.undash();

        // Draw corner cut marks to show top-most overlay layer.
        const mark = 14;
        ctx.lineWidth(1.5).strokeColor('#16a34a').opacity(0.9);

        ctx.moveTo(x, y)
            .lineTo(x + mark, y)
            .stroke();
        ctx.moveTo(x, y)
            .lineTo(x, y + mark)
            .stroke();

        ctx.moveTo(x + w, y)
            .lineTo(x + w - mark, y)
            .stroke();
        ctx.moveTo(x + w, y)
            .lineTo(x + w, y + mark)
            .stroke();

        ctx.moveTo(x, y + h)
            .lineTo(x + mark, y + h)
            .stroke();
        ctx.moveTo(x, y + h)
            .lineTo(x, y + h - mark)
            .stroke();

        ctx.moveTo(x + w, y + h)
            .lineTo(x + w - mark, y + h)
            .stroke();
        ctx.moveTo(x + w, y + h)
            .lineTo(x + w, y + h - mark)
            .stroke();

        ctx.restore();
    },
};
