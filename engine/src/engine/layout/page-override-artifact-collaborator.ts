import { findWinningPageOverride } from './layout-page-finalization';
import { LayoutCollaborator, LayoutSession } from './layout-session';
import { simulationArtifactKeys } from './simulation-report';

export type PageOverrideSummary = {
    pageIndex: number;
    overrideSourceId: string | null;
    headerOverride: 'inherit' | 'replace' | 'suppress';
    footerOverride: 'inherit' | 'replace' | 'suppress';
};

function resolveOverrideState(value: unknown): 'inherit' | 'replace' | 'suppress' {
    if (value === undefined) return 'inherit';
    if (value === null) return 'suppress';
    return 'replace';
}

export class PageOverrideArtifactCollaborator implements LayoutCollaborator {
    onSimulationComplete(session: LayoutSession): void {
        const pages = session.getFinalizedPages();
        const summaries: PageOverrideSummary[] = pages.map((page) => {
            const winningOverride = findWinningPageOverride(page);
            let overrideSourceId: string | null = null;

            if (winningOverride) {
                for (const box of page.boxes || []) {
                    const overrides = box.properties?.pageOverrides;
                    if (!overrides) continue;
                    const sameHeader = overrides.header === winningOverride.header;
                    const sameFooter = overrides.footer === winningOverride.footer;
                    if (!sameHeader && !sameFooter) continue;
                    overrideSourceId = box.meta?.sourceId ?? null;
                    break;
                }
            }

            return {
                pageIndex: page.index,
                overrideSourceId,
                headerOverride: resolveOverrideState(winningOverride?.header),
                footerOverride: resolveOverrideState(winningOverride?.footer)
            };
        });

        session.publishArtifact(simulationArtifactKeys.pageOverrideSummary, summaries);
    }
}
