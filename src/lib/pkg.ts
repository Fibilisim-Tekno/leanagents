import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Walks up from a starting directory until it finds a directory containing
 * package.json. Works from both `src/` (tsx) and `dist/` (built) layouts.
 */
export function findPackageRoot(startDir?: string): string {
  let current = resolve(startDir ?? dirname(fileURLToPath(import.meta.url)));

  // Bounded walk: 10 levels is far more than the repo nesting depth.
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(current, 'package.json'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error('Could not locate package.json above ' + (startDir ?? 'the module directory'));
}

interface PackageManifest {
  name?: string;
  version?: string;
}

export function readManifest(startDir?: string): PackageManifest {
  const rootDir = findPackageRoot(startDir);
  const raw = readFileSync(join(rootDir, 'package.json'), 'utf8');
  return JSON.parse(raw) as PackageManifest;
}

export function getVersion(startDir?: string): string {
  const version = readManifest(startDir).version;
  if (!version) {
    throw new Error('package.json has no "version" field');
  }
  return version;
}

export function getPackageName(startDir?: string): string {
  const name = readManifest(startDir).name;
  if (!name) {
    throw new Error('package.json has no "name" field');
  }
  return name;
}
