export type TransmuterOptions = {
    config?: string;
    theme?: string;
};

export interface Transmuter<
    Input = string,
    Output = unknown,
    Options extends TransmuterOptions = TransmuterOptions
> {
    transmute(input: Input, options?: Options): Output;
    getBoilerplate?(): string;
}
