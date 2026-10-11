// Runs api and web dev servers together; avoids a dependency just for process fan-out.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const targets = ['apps/api', 'apps/web'];

const children = targets.map((workspace) => {
  const child = spawn(npm, ['run', 'dev', '-w', workspace], { stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code) => shutdown(code ?? 1));
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
