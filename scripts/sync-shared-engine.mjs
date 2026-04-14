import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharedRoot = path.resolve(repoRoot, '../vmprint-engine-shared');
const manifestPath = path.join(sharedRoot, 'SYNC-MANIFEST.json');

function walkFiles(rootDir, currentDir = rootDir, files = []) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
            walkFiles(rootDir, fullPath, files);
            continue;
        }
        if (!entry.isFile()) continue;
        files.push(path.relative(rootDir, fullPath));
    }
    return files.sort((left, right) => left.localeCompare(right));
}

function normalize(value) {
    return value.replace(/\\/g, '/');
}

function readManifest() {
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`Shared engine manifest not found at ${manifestPath}`);
    }
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function main() {
    const manifest = readManifest();
    const sourceRoot = path.join(sharedRoot, manifest.sourceRoot);
    const targetRoot = path.join(repoRoot, manifest.targetRoot);
    const checkOnly = process.argv.includes('--check');

    if (!fs.existsSync(sourceRoot)) {
        throw new Error(`Shared source root not found at ${sourceRoot}`);
    }
    if (!fs.existsSync(targetRoot)) {
        throw new Error(`Target root not found at ${targetRoot}`);
    }

    const sourceFiles = walkFiles(sourceRoot);
    let copied = 0;
    let changed = 0;
    let missing = 0;

    for (const relativePath of sourceFiles) {
        const sourcePath = path.join(sourceRoot, relativePath);
        const targetPath = path.join(targetRoot, relativePath);
        const sourceBuffer = fs.readFileSync(sourcePath);
        const targetExists = fs.existsSync(targetPath);
        const targetBuffer = targetExists ? fs.readFileSync(targetPath) : null;
        const differs = !targetExists || !sourceBuffer.equals(targetBuffer);

        if (differs) {
            changed += 1;
            if (!targetExists) missing += 1;
            if (!checkOnly) {
                fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                fs.writeFileSync(targetPath, sourceBuffer);
                copied += 1;
            }
        }
    }

    console.log(`[sync-shared-engine] repo=${path.basename(repoRoot)}`);
    console.log(`[sync-shared-engine] source=${normalize(sourceRoot)}`);
    console.log(`[sync-shared-engine] target=${normalize(targetRoot)}`);
    console.log(`[sync-shared-engine] files=${sourceFiles.length} changed=${changed} missing=${missing}`);

    if (checkOnly) {
        if (changed > 0) {
            console.log('[sync-shared-engine] shared snapshot differs from the repo copy.');
            process.exitCode = 1;
            return;
        }
        console.log('[sync-shared-engine] repo copy matches the shared snapshot.');
        return;
    }

    console.log(`[sync-shared-engine] copied=${copied}`);
}

main();
