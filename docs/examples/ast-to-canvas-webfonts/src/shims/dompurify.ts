type DomPurifyLike = {
    sanitize: (input: string) => string;
};

// Intentional no-op: this browser demo uses StandardFontManager and the PDF Lite
// context, which do not render inline HTML. DOMPurify is shimmed out to keep the
// bundle small. If you add a context that renders user-supplied HTML, replace this
// with the real dompurify package.
const domPurifyShim: DomPurifyLike = {
    sanitize(input: string): string {
        return input;
    }
};

export default domPurifyShim;
