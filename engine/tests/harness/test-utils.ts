export function logStep(prefix: string, message: string): void {
    console.log(`[${prefix}] ${message}`);
}

export function check(prefix: string, description: string, expected: string, assertion: () => void): void {
    logStep(prefix, `CHECK: ${description}`);
    logStep(prefix, `EXPECT: ${expected}`);
    assertion();
    logStep(prefix, `PASS: ${description}`);
}

export async function checkAsync(prefix: string, description: string, expected: string, assertion: () => Promise<void>): Promise<void> {
    logStep(prefix, `CHECK: ${description}`);
    logStep(prefix, `EXPECT: ${expected}`);
    await assertion();
    logStep(prefix, `PASS: ${description}`);
}

export function assertNoInputMutation(assertion: any, elements: any[], fixtureName: string): void {
    const visit = (node: any) => {
        assertion.equal(node?.properties?._box, undefined, `${fixtureName}: input node mutated with _box`);
        if (Array.isArray(node?.children)) {
            node.children.forEach(visit);
        }
    };
    elements.forEach(visit);
}
