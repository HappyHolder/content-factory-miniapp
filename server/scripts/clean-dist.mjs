import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.resolve(serverRoot, 'dist');

if (path.dirname(dist) !== serverRoot || path.basename(dist) !== 'dist') {
  throw new Error(`Refusing to clean unexpected build directory: ${dist}`);
}

fs.rmSync(dist, { recursive: true, force: true });
