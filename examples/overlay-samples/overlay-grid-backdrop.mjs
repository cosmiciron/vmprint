export default {
    backdrop(page, ctx) {
        ctx.save();
        ctx.strokeColor('#cbd5e1').lineWidth(0.4).dash(2, { space: 4 });

        for (let x = 0; x <= page.width; x += 36) {
            ctx.moveTo(x, 0).lineTo(x, page.height).stroke();
        }

        for (let y = 0; y <= page.height; y += 36) {
            ctx.moveTo(0, y).lineTo(page.width, y).stroke();
        }

        ctx.undash();
        ctx.restore();
    },
};
