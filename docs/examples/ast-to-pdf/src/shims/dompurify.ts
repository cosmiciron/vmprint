type DomPurifyLike = {
    sanitize: (input: string) => string;
};

const domPurifyShim: DomPurifyLike = {
    sanitize(input: string): string {
        return input;
    }
};

export default domPurifyShim;
