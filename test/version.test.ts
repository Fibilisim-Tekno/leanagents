import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findPackageRoot, getPackageName, getVersion } from '../src/lib/pkg.js';
import { buildProgram } from '../src/cli.js';

/** Reads package.json independently of the code under test. */
function manifestFromDisk(): { name: string; version: string } {
  const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf8');
  return JSON.parse(raw) as { name: string; version: string };
}

describe('package metadata', () => {
  it('reports the version declared in package.json', () => {
    expect(getVersion()).toBe(manifestFromDisk().version);
  });

  it('reports the package name declared in package.json', () => {
    expect(getPackageName()).toBe('@fibilisim/leanagents');
    expect(getPackageName()).toBe(manifestFromDisk().name);
  });

  it('resolves a package root that actually contains package.json', () => {
    const root = findPackageRoot();
    expect(() => readFileSync(join(root, 'package.json'), 'utf8')).not.toThrow();
  });

  it('throws a clear error when no package.json exists above the start directory', () => {
    expect(() => findPackageRoot('/')).toThrow(/Could not locate package.json/);
  });
});

describe('cli program', () => {
  it('registers the leanagents name and a description', () => {
    const program = buildProgram();
    expect(program.name()).toBe('leanagents');
    expect(program.description()).toMatch(/token/i);
  });

  it('exposes the package version through --version', () => {
    const program = buildProgram();
    expect(program.version()).toBe(manifestFromDisk().version);
  });

  it('renders help text that includes the program name', () => {
    const help = buildProgram().helpInformation();
    expect(help).toContain('leanagents');
    expect(help).toContain('--version');
  });
});
