export interface SourceTransformer<Input = unknown, Output = unknown> {
    transform(input: Input): Output;
}
