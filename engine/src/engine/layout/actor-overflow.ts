export type ActorOverflowPreSplitOutcome =
    | 'force-commit-at-top'
    | 'advance-page-before-split'
    | 'continue-to-split-phase';

export type ActorSplitEntryOutcome =
    | 'advance-page-for-top-split'
    | 'attempt-split-now';

export type ActorOverflowHandling = {
    preSplitOutcome: ActorOverflowPreSplitOutcome;
    splitEntryOutcome: ActorSplitEntryOutcome | null;
};

function getActorOverflowPreSplitOutcome(input: {
    isAtPageTop: boolean;
    isUnbreakable: boolean;
    hasPreviewBoxes: boolean;
}): ActorOverflowPreSplitOutcome {
    if (input.isAtPageTop && input.isUnbreakable) {
        return 'force-commit-at-top';
    }

    if (!input.isAtPageTop && (input.isUnbreakable || !input.hasPreviewBoxes)) {
        return 'advance-page-before-split';
    }

    return 'continue-to-split-phase';
}

function getActorSplitEntryOutcome(input: {
    isAtPageTop: boolean;
    allowsMidPageSplit: boolean;
    overflowsEmptyPage: boolean;
}): ActorSplitEntryOutcome {
    if (!input.isAtPageTop && !input.allowsMidPageSplit && input.overflowsEmptyPage) {
        return 'advance-page-for-top-split';
    }

    return 'attempt-split-now';
}

export function getActorOverflowHandling(input: {
    isAtPageTop: boolean;
    isUnbreakable: boolean;
    hasPreviewBoxes: boolean;
    allowsMidPageSplit: boolean;
    overflowsEmptyPage: boolean;
}): ActorOverflowHandling {
    const preSplitOutcome = getActorOverflowPreSplitOutcome(input);
    return {
        preSplitOutcome,
        splitEntryOutcome: preSplitOutcome === 'continue-to-split-phase'
            ? getActorSplitEntryOutcome(input)
            : null
    };
}
