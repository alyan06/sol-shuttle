// Runs the dev server on local file storage (.data/), never the hosted database, so trying things
// out can't touch live settings or send real alerts. `--passcode <value>` turns the lock on, and
// `--replay` plays a recorded trip instead of the live bus.
import { spawn } from 'node:child_process';

const flag = process.argv.indexOf('--passcode');
const env = {
  ...process.env,
  SUPABASE_URL: '',
  APP_PASSCODE: flag === -1 ? '' : (process.argv[flag + 1] ?? ''),
  SHUTTLE_REPLAY: process.argv.includes('--replay') ? '1' : '',
};
const child = spawn('npx', ['next', 'dev', '-p', '3240'], { stdio: 'inherit', env, shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
