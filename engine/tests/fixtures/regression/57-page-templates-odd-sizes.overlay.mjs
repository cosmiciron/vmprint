export default {
    backdrop(page, ctx) {
        const colors = ['#bfdbfe', '#a7f3d0', '#fde68a'];
        const color = colors[page.index % colors.length];
        ctx.save();
        ctx.opacity(0.22).fillColor(color).rect(0, 0, page.width, page.height).fill();
        ctx.restore();

        ctx.save();
        ctx.lineWidth(2).strokeColor('#0f172a').rect(1, 1, page.width - 2, page.height - 2).stroke();
        ctx.lineWidth(0.7).dash(4, { space: 3 }).strokeColor('#64748b');
        const minX = Math.min(...page.boxes.map((box) => box.x).filter(Number.isFinite));
        const maxX = Math.max(...page.boxes.map((box) => box.x + box.w).filter(Number.isFinite));
        const minY = Math.min(...page.boxes.map((box) => box.y).filter(Number.isFinite));
        const maxY = Math.max(...page.boxes.map((box) => box.y + box.h).filter(Number.isFinite));
        if (Number.isFinite(minX) && Number.isFinite(maxX) && Number.isFinite(minY) && Number.isFinite(maxY)) {
            ctx.rect(minX, minY, maxX - minX, maxY - minY).stroke();
        }
        ctx.undash();
        ctx.restore();
    },
    overlay(page, ctx) {
        ctx.save();
        ctx.font('Helvetica', 8).fillColor('#0f172a').opacity(0.8);
        ctx.text(`engine page ${page.index + 1}: ${page.width} x ${page.height} pt`, 8, Math.max(8, page.height - 16));
        ctx.restore();
    }
};
