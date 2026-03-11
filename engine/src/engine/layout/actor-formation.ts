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
};

export function formationWantsWholeCommit(plan: KeepWithNextFormationPlan): boolean {
    return plan.resolution.action === 'commit-whole' || plan.resolution.action === 'single-actor';
}

export function formationWantsWholeDeferral(plan: KeepWithNextFormationPlan): boolean {
    return plan.resolution.action === 'defer-whole';
}

export function formationWantsTailSplit(plan: KeepWithNextFormationPlan): boolean {
    return plan.resolution.action === 'split-tail';
}
