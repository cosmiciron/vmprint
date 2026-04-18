export type SvgPathPoint = {
    x: number;
    y: number;
};

export type SvgPathSubpath = {
    closed: boolean;
    points: SvgPathPoint[];
};

type ParsedNumberSequence = {
    values: number[];
    nextIndex: number;
};

const COMMAND_CHARS = new Set(['M', 'm', 'L', 'l', 'H', 'h', 'V', 'v', 'Z', 'z']);

export function parseSvgPathSubpaths(path: string): SvgPathSubpath[] {
    const source = String(path || '').trim();
    if (!source) return [];

    const subpaths: SvgPathSubpath[] = [];
    let index = 0;
    let command = '';
    let currentX = 0;
    let currentY = 0;
    let subpathStartX = 0;
    let subpathStartY = 0;
    let activeSubpath: SvgPathSubpath | null = null;

    const ensureSubpath = (): SvgPathSubpath => {
        if (activeSubpath) return activeSubpath;
        activeSubpath = { closed: false, points: [] };
        subpaths.push(activeSubpath);
        return activeSubpath;
    };

    while (index < source.length) {
        const nextIndex = skipSvgSeparators(source, index);
        if (nextIndex >= source.length) break;
        index = nextIndex;

        const candidate = source[index]!;
        if (COMMAND_CHARS.has(candidate)) {
            command = candidate;
            index += 1;
        } else if (!command) {
            throw new Error(`[svg-path] Path must begin with a command. Received: "${source}"`);
        }

        switch (command) {
            case 'M':
            case 'm': {
                const { values, nextIndex: consumedIndex } = parseSvgPathNumbers(source, index);
                if (values.length < 2 || values.length % 2 !== 0) {
                    throw new Error(`[svg-path] Move command requires one or more coordinate pairs. Received: "${source}"`);
                }
                index = consumedIndex;
                activeSubpath = null;
                for (let offset = 0; offset < values.length; offset += 2) {
                    const rawX = values[offset]!;
                    const rawY = values[offset + 1]!;
                    const x = command === 'm' ? currentX + rawX : rawX;
                    const y = command === 'm' ? currentY + rawY : rawY;
                    if (offset === 0) {
                        const subpath = ensureSubpath();
                        subpath.points.push({ x, y });
                        currentX = x;
                        currentY = y;
                        subpathStartX = x;
                        subpathStartY = y;
                        continue;
                    }
                    ensureSubpath().points.push({ x, y });
                    currentX = x;
                    currentY = y;
                }
                command = command === 'm' ? 'l' : 'L';
                break;
            }
            case 'L':
            case 'l': {
                const { values, nextIndex: consumedIndex } = parseSvgPathNumbers(source, index);
                if (values.length < 2 || values.length % 2 !== 0) {
                    throw new Error(`[svg-path] Line command requires one or more coordinate pairs. Received: "${source}"`);
                }
                index = consumedIndex;
                const subpath = ensureSubpath();
                for (let offset = 0; offset < values.length; offset += 2) {
                    const rawX = values[offset]!;
                    const rawY = values[offset + 1]!;
                    const x = command === 'l' ? currentX + rawX : rawX;
                    const y = command === 'l' ? currentY + rawY : rawY;
                    subpath.points.push({ x, y });
                    currentX = x;
                    currentY = y;
                }
                break;
            }
            case 'H':
            case 'h': {
                const { values, nextIndex: consumedIndex } = parseSvgPathNumbers(source, index);
                if (values.length === 0) {
                    throw new Error(`[svg-path] Horizontal line command requires at least one coordinate. Received: "${source}"`);
                }
                index = consumedIndex;
                const subpath = ensureSubpath();
                for (const rawX of values) {
                    const x = command === 'h' ? currentX + rawX : rawX;
                    subpath.points.push({ x, y: currentY });
                    currentX = x;
                }
                break;
            }
            case 'V':
            case 'v': {
                const { values, nextIndex: consumedIndex } = parseSvgPathNumbers(source, index);
                if (values.length === 0) {
                    throw new Error(`[svg-path] Vertical line command requires at least one coordinate. Received: "${source}"`);
                }
                index = consumedIndex;
                const subpath = ensureSubpath();
                for (const rawY of values) {
                    const y = command === 'v' ? currentY + rawY : rawY;
                    subpath.points.push({ x: currentX, y });
                    currentY = y;
                }
                break;
            }
            case 'Z':
            case 'z': {
                const subpath = ensureSubpath();
                subpath.closed = true;
                currentX = subpathStartX;
                currentY = subpathStartY;
                activeSubpath = null;
                break;
            }
            default:
                throw new Error(`[svg-path] Unsupported path command "${command}" in "${source}".`);
        }
    }

    return subpaths
        .map((subpath) => ({
            closed: subpath.closed,
            points: dedupeSequentialPoints(subpath.points)
        }))
        .filter((subpath) => subpath.points.length >= 2);
}

export function translateSvgPath(path: string, dx: number, dy: number): string {
    const subpaths = parseSvgPathSubpaths(path);
    if (subpaths.length === 0) return '';
    return serializeSvgPathSubpaths(subpaths.map((subpath) => ({
        closed: subpath.closed,
        points: subpath.points.map((point) => ({
            x: point.x + dx,
            y: point.y + dy
        }))
    })));
}

export function serializeSvgPathSubpaths(subpaths: readonly SvgPathSubpath[]): string {
    const parts: string[] = [];
    for (const subpath of subpaths) {
        if (!Array.isArray(subpath.points) || subpath.points.length === 0) continue;
        parts.push(`M${formatSvgNumber(subpath.points[0]!.x)},${formatSvgNumber(subpath.points[0]!.y)}`);
        for (let index = 1; index < subpath.points.length; index++) {
            const point = subpath.points[index]!;
            parts.push(`L${formatSvgNumber(point.x)},${formatSvgNumber(point.y)}`);
        }
        if (subpath.closed) {
            parts.push('Z');
        }
    }
    return parts.join(' ');
}

function parseSvgPathNumbers(source: string, startIndex: number): ParsedNumberSequence {
    const values: number[] = [];
    let index = startIndex;

    while (index < source.length) {
        index = skipSvgSeparators(source, index);
        if (index >= source.length) break;
        if (COMMAND_CHARS.has(source[index]!)) break;

        const remainder = source.slice(index);
        const match = remainder.match(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
        if (!match) {
            throw new Error(`[svg-path] Invalid numeric token near "${remainder.slice(0, 12)}".`);
        }
        values.push(Number(match[0]));
        index += match[0].length;
    }

    return { values, nextIndex: index };
}

function skipSvgSeparators(source: string, startIndex: number): number {
    let index = startIndex;
    while (index < source.length) {
        const char = source[index]!;
        if (char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === ',') {
            index += 1;
            continue;
        }
        break;
    }
    return index;
}

function dedupeSequentialPoints(points: readonly SvgPathPoint[]): SvgPathPoint[] {
    const deduped: SvgPathPoint[] = [];
    for (const point of points) {
        const previous = deduped[deduped.length - 1];
        if (previous && approximatelyEqual(previous.x, point.x) && approximatelyEqual(previous.y, point.y)) {
            continue;
        }
        deduped.push({ x: point.x, y: point.y });
    }
    return deduped;
}

function approximatelyEqual(left: number, right: number): boolean {
    return Math.abs(Number(left) - Number(right)) <= 0.0001;
}

function formatSvgNumber(value: number): string {
    const normalized = Number(Number(value).toFixed(4));
    return Number.isFinite(normalized) ? String(normalized) : '0';
}
