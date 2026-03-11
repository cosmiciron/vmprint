import type { PackagerUnit } from './packagers/packager-types';

export type ActorFormationPolicy = 'keep-with-next';

export type ActorFormationMemberRole = 'leader' | 'member' | 'tail-split-candidate';

export type ActorFormationMember = {
    actor: PackagerUnit;
    role: ActorFormationMemberRole;
    measuredHeight: number;
    nextSpacingAfter: number;
};

export type ActorFormation = {
    formationId: string;
    policy: ActorFormationPolicy;
    availableWidth: number;
    availableHeight: number;
    members: ActorFormationMember[];
};

export type ActorFormationAssessment = {
    wholeFits: boolean;
    prefixFits: boolean;
    memberCount: number;
    prefixCount: number;
    tailSplitCandidateActorId: string | null;
    tailSplitViable: boolean;
    tailSplitAllowedAtCurrentPosition: boolean;
    tailSplitBreakableInCurrentTerrain: boolean;
    tailSplitViableWithMarkerReserve: boolean;
    requiresPageAdvance: boolean;
};

export type ActorFormationResolution =
    | { action: 'commit-whole' }
    | { action: 'defer-whole' }
    | { action: 'split-tail'; prefixCount: number; splitCandidateActorId: string }
    | { action: 'single-actor' };

export type KeepWithNextFormationPlan = {
    formation: ActorFormation;
    assessment: ActorFormationAssessment;
    resolution: ActorFormationResolution;
    sequence: PackagerUnit[];
    sequenceHeight: number;
    fitsOnCurrent: boolean;
    prefix: PackagerUnit[];
    prefixHeight: number;
    prefixFits: boolean;
    splitCandidate: PackagerUnit | null;
    splitMarkerReserve?: number;
};

export function formationWantsWholeCommit(plan: KeepWithNextFormationPlan): boolean {
    return plan.resolution.action === 'commit-whole' || plan.resolution.action === 'single-actor';
}

export function formationWantsWholeDeferral(plan: KeepWithNextFormationPlan): boolean {
    return plan.resolution.action === 'defer-whole';
}

export function formationWholeFits(plan: KeepWithNextFormationPlan): boolean {
    return plan.assessment.wholeFits;
}

export function formationRequiresPageAdvance(plan: KeepWithNextFormationPlan): boolean {
    return plan.assessment.requiresPageAdvance;
}

export function formationMustAdvancePage(plan: KeepWithNextFormationPlan, isAtPageTop: boolean): boolean {
    return !isAtPageTop && formationRequiresPageAdvance(plan);
}

export function formationWantsTailSplit(plan: KeepWithNextFormationPlan): boolean {
    return plan.resolution.action === 'split-tail';
}

export function formationCanExecuteTailSplit(plan: KeepWithNextFormationPlan): boolean {
    return (
        plan.resolution.action === 'split-tail' &&
        plan.assessment.tailSplitAllowedAtCurrentPosition &&
        plan.assessment.tailSplitViableWithMarkerReserve
    );
}

export function getTailSplitExecution(plan: KeepWithNextFormationPlan): {
    prefix: PackagerUnit[];
    splitCandidate: PackagerUnit;
    replaceCount: number;
    splitMarkerReserve: number;
} | null {
    if (plan.resolution.action !== 'split-tail') {
        return null;
    }

    const members = plan.formation.members;
    const prefixMembers = members.slice(0, plan.resolution.prefixCount);
    const prefix = prefixMembers.map(member => member.actor);
    const splitCandidate = members[plan.resolution.prefixCount]?.actor ?? null;
    if (!splitCandidate) return null;

    return {
        prefix,
        splitCandidate,
        replaceCount: members.length,
        splitMarkerReserve: plan.splitMarkerReserve ?? 0
    };
}
