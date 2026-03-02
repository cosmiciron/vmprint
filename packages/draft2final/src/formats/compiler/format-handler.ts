import type { SemanticNode } from '../../semantic';
import type { FormatContext } from './format-context';

export interface FormatHandler {
    /**
     * Called for each top-level SemanticNode in document order.
     * May call any FormatContext methods including multiple emit() calls per block.
     */
    handleBlock(node: SemanticNode, ctx: FormatContext): void;

    /**
     * Called once after all nodes have been fed.
     * Must flush any accumulated state (pending structures, reference registries, etc.).
     */
    flush(ctx: FormatContext): void;

    /**
     * Returns the set of role names this format may emit.
     * Used for static coverage checks and documentation.
     */
    roles(): string[];
}
