import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(scriptDir, '..');
const sourceDir = join(rootDir, 'kinda newer html');
const targetDir = join(rootDir, 'public', 'kinda newer html');

if (!existsSync(sourceDir)) {
  throw new Error(`Missing demo HTML source folder: ${sourceDir}`);
}

mkdirSync(dirname(targetDir), { recursive: true });
rmSync(targetDir, { recursive: true, force: true });
cpSync(sourceDir, targetDir, { recursive: true });

console.log(`Copied demo HTML from ${sourceDir} to ${targetDir}`);
