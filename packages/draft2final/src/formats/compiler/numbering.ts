export function toAlpha(value: number, upper: boolean): string {
    let n = Math.max(1, Math.floor(value));
    let out = '';
    while (n > 0) {
        n -= 1;
        const charCode = (n % 26) + 97;
        out = String.fromCharCode(charCode) + out;
        n = Math.floor(n / 26);
    }
    return upper ? out.toUpperCase() : out;
}

export function toRoman(value: number, upper: boolean): string {
    let n = Math.max(1, Math.floor(value));
    const numerals: Array<[number, string]> = [
        [1000, 'm'],
        [900, 'cm'],
        [500, 'd'],
        [400, 'cd'],
        [100, 'c'],
        [90, 'xc'],
        [50, 'l'],
        [40, 'xl'],
        [10, 'x'],
        [9, 'ix'],
        [5, 'v'],
        [4, 'iv'],
        [1, 'i'],
    ];
    let out = '';
    for (const [unit, token] of numerals) {
        while (n >= unit) {
            out += token;
            n -= unit;
        }
    }
    return upper ? out.toUpperCase() : out;
}

export function formatNumber(
    value: number,
    style: 'decimal' | 'lower-alpha' | 'upper-alpha' | 'lower-roman' | 'upper-roman',
): string {
    switch (style) {
        case 'lower-alpha':
            return toAlpha(value, false);
        case 'upper-alpha':
            return toAlpha(value, true);
        case 'lower-roman':
            return toRoman(value, false);
        case 'upper-roman':
            return toRoman(value, true);
        case 'decimal':
        default:
            return String(value);
    }
}
