export const _downloadTracker = {
    active: new Map<string, number>(),
    interval: null as any,
    update(name: string, mb: number) {
        if (!this.active.has(name) && (typeof process === 'undefined' || !process.stdout?.isTTY)) {
            console.log(`[LocalFontManager] Downloading ${name}...`);
        }
        this.active.set(name, mb);
        if (!this.interval && typeof process !== 'undefined' && process.stdout?.isTTY) {
            this.interval = setInterval(() => this.render(), 100);
        }
    },
    remove(name: string) {
        this.active.delete(name);
        if (typeof process === 'undefined' || !process.stdout?.isTTY) {
            console.log(`[LocalFontManager] Cached ${name}`);
        }
        if (this.active.size === 0 && this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            if (typeof process !== 'undefined' && process.stdout?.isTTY) {
                process.stdout.write('\r\x1b[K'); // clear line
            }
        } else if (this.interval) {
            this.render();
        }
    },
    render() {
        if (typeof process === 'undefined' || !process.stdout?.isTTY) return;
        const parts = Array.from(this.active.entries()).map(([n, v]) => `${n}: ${v.toFixed(2)}MB`);
        process.stdout.write(`\r\x1b[K[Downloading] ${parts.join(' | ')}`);
    }
};
