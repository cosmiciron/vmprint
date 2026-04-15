import type { Context } from '../contracts';
import type { Page } from './types';
import { BaseRenderer } from './base-renderer';

/**
 * Canonical VMPrint renderer that emits to the stable Context contract.
 */
export class ContextRenderer extends BaseRenderer {
    async render(pages: Page[], context: Context): Promise<void> {
        await this.registerFonts(context, pages);

        pages.forEach((page) => {
            context.addPage();
            if (this.config.layout.pageBackground) {
                context.save();
                context.fillColor(this.config.layout.pageBackground).opacity(1)
                    .rect(0, 0, page.width, page.height).fill();
                context.restore();
            }
            const hasOverlay = !!(this.overlay?.backdrop || this.overlay?.overlay);
            const overlayPage = hasOverlay ? this.toOverlayPage(page) : undefined;
            const overlayContext = hasOverlay ? this.wrapOverlayContext(context) : undefined;

            if (this.overlay?.backdrop && overlayPage && overlayContext) {
                this.overlay.backdrop(overlayPage, overlayContext);
            }

            const drawOrder = this.getPageDrawOrder(page);
            drawOrder.forEach(({ box }) => this.drawContextBox(context, box));

            if (this.debug) {
                this.drawContextDebugPage(context, page, drawOrder);
            }

            if (this.overlay?.overlay && overlayPage && overlayContext) {
                this.overlay.overlay(overlayPage, overlayContext);
            }
        });

        context.end();
    }
}
