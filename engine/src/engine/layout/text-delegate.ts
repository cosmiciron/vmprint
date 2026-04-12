/**
 * Compatibility shim.
 *
 * VMPrint's concrete text delegate is a print/bootstrap concern that currently
 * lives under `font-management`. The neutral engine should depend on the
 * delegate contract provided by the runtime rather than on this deep import.
 */
export * from '../../font-management/text-delegate';
