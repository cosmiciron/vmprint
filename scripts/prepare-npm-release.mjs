import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const rootPackageJsonPath = path.join(repoRoot, 'package.json');
const stageRoot = process.env.VMPRINT_RELEASE_DIR
    ? path.resolve(process.env.VMPRINT_RELEASE_DIR)
    : path.resolve(repoRoot, '..', 'vmprint-npm-release');

const packageDirs = [
    'contracts',
    'engine',
    'preview',
    'cli'
];

const dependencySections = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies'
];

const rootPackage = JSON.parse(fs.readFileSync(rootPackageJsonPath, 'utf8'));
const defaultVersion = process.env.VMPRINT_RELEASE_VERSION || rootPackage.version;

const packages = packageDirs.map((dir) => {
    const packageJsonPath = path.join(repoRoot, dir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    return {
        dir,
        srcDir: path.join(repoRoot, dir),
        stageDir: path.join(stageRoot, dir),
        packageJsonPath,
        pkg,
        name: pkg.name,
        version: pkg.version || defaultVersion
    };
});

const versionByPackageName = new Map(
    packages.map((entry) => [entry.name, process.env.VMPRINT_RELEASE_VERSION || entry.version || defaultVersion])
);

function copyPackageDirectory(srcDir, destDir) {
    fs.mkdirSync(path.dirname(destDir), { recursive: true });
    fs.cpSync(srcDir, destDir, {
        recursive: true,
        filter: (source) => {
            const base = path.basename(source);
            if (base === 'node_modules' || base === '.turbo') {
                return false;
            }
            if (base === 'package-lock.json' || base === '.tsbuildinfo') {
                return false;
            }
            if (base.endsWith('.tgz')) {
                return false;
            }
            return true;
        }
    });
}

function rewriteInternalDeps(pkg) {
    for (const section of dependencySections) {
        const deps = pkg[section];
        if (!deps || typeof deps !== 'object') {
            continue;
        }

        for (const [depName, depSpec] of Object.entries(deps)) {
            if (!versionByPackageName.has(depName)) {
                continue;
            }
            if (typeof depSpec !== 'string') {
                continue;
            }
            if (!depSpec.startsWith('file:') && !depSpec.startsWith('workspace:')) {
                continue;
            }
            deps[depName] = `^${versionByPackageName.get(depName)}`;
        }
    }
}

function ensureCliShebang(stageDir, pkg) {
    if (!pkg.bin || typeof pkg.bin !== 'object') {
        return;
    }

    for (const relativeBinPath of Object.values(pkg.bin)) {
        if (typeof relativeBinPath !== 'string') {
            continue;
        }
        const absoluteBinPath = path.join(stageDir, relativeBinPath);
        if (!fs.existsSync(absoluteBinPath)) {
            continue;
        }
        const contents = fs.readFileSync(absoluteBinPath, 'utf8');
        if (contents.startsWith('#!/usr/bin/env node')) {
            continue;
        }
        fs.writeFileSync(absoluteBinPath, `#!/usr/bin/env node\n${contents}`);
    }
}

fs.rmSync(stageRoot, { recursive: true, force: true });
fs.mkdirSync(stageRoot, { recursive: true });

for (const entry of packages) {
    copyPackageDirectory(entry.srcDir, entry.stageDir);

    const stagedPackageJsonPath = path.join(entry.stageDir, 'package.json');
    const stagedPkg = JSON.parse(fs.readFileSync(stagedPackageJsonPath, 'utf8'));
    stagedPkg.name = entry.name;
    stagedPkg.version = process.env.VMPRINT_RELEASE_VERSION || entry.version || defaultVersion;
    rewriteInternalDeps(stagedPkg);

    // Clean up scripts that shouldn't run during publish from the staging dir
    if (stagedPkg.scripts) {
        delete stagedPkg.scripts.prepublishOnly;
        delete stagedPkg.scripts.prepare;
    }

    fs.writeFileSync(stagedPackageJsonPath, `${JSON.stringify(stagedPkg, null, 2)}\n`);

    ensureCliShebang(entry.stageDir, stagedPkg);
    console.log(`[prepare-npm-release] Staged ${stagedPkg.name} -> ${path.relative(repoRoot, entry.stageDir)}`);
}

console.log('');
console.log(`[prepare-npm-release] Release staging is ready in ${path.relative(repoRoot, stageRoot)}`);
console.log('[prepare-npm-release] Publish from the staged package directories so your workspace manifests stay unchanged.');
