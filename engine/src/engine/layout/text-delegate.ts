/**
 * Compatibility shim.
 *
 * Neutral engine code should depend only on the TextDelegate contract.
 * Concrete implementations belong to bootstrap or product assembly code
 * outside the engine directory.
 */
export type {
    MeasureTextOptions,
    MeasuredTextResult,
    TextDelegate,
    TextDelegateState,
    TextMeasurer,
    VerticalTextMetrics
} from '../../contracts/text-delegate';
