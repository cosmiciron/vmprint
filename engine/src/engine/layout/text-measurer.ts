/**
 * Compatibility shim.
 *
 * The engine depends on the text-measurer contract. Concrete measurer classes
 * belong to bootstrap code outside the engine directory.
 */
export type {
    TextMeasurer
} from '../../contracts/text-delegate';
