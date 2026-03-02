export default {
    overlay(page, ctx) {
        for (const box of page.boxes) {
            if (box.type !== 'p') {
                continue;
            }

            ctx.save();
            ctx.strokeColor('#ef4444').lineWidth(1).opacity(0.7);
            ctx.rect(box.x, box.y, box.w, box.h).stroke();
            ctx.restore();
        }
    },
};
