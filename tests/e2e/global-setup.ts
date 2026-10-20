import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Makes sure the generated video fixtures exist before any test runs. */
export default function globalSetup() {
  const script = fileURLToPath(new URL('../fixtures/generate.sh', import.meta.url));
  execFileSync('sh', [script], { stdio: 'inherit' });
}
