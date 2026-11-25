// Checks that no secret from .env.local has reached anywhere public: the files about to be
// committed, any commit ever made, or (with --bundle, after `next build`) the code sent to browsers.
// Prints a secret's NAME and where it was found, never its value. Exits 1 if anything turns up.
//
//   npm run check:secrets
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const NAMES = [
  'SAMSARA_SHARE_TOKEN',
  'VAPID_PRIVATE_KEY',
  'TICK_SECRET',
  'SHUTTLE_STORE_KEY',
  'APP_PASSCODE',
  'SESSION_SECRET',
  'SUPABASE_PUBLISHABLE_KEY',
  'GOOGLE_CLIENT_SECRET',
  'JOIN_CODE',
  'VERCEL_OIDC_TOKEN',
];
const secrets = NAMES.map((name) => [name, process.env[name]]).filter(([, value]) => value && value.length > 5);
if (secrets.length === 0) {
  console.log('No secrets loaded. Run with: node --env-file=.env.local scripts/check-secrets.mjs');
  process.exit(1);
}

let problems = 0;
const report = (where, name) => {
  problems++;
  console.log(`FOUND ${name} in ${where}`);
};

// The working tree: tracked files and new ones git would pick up.
const files = execSync('git ls-files -co --exclude-standard', { encoding: 'utf8' })
  .split('\n')
  .filter((file) => file && existsSync(file) && statSync(file).isFile());
for (const file of files) {
  const text = readFileSync(file, 'latin1');
  for (const [name, value] of secrets) if (text.includes(value)) report(file, name);
}

// Every commit on every branch.
const history = execSync('git log --all -p --no-color', { encoding: 'utf8', maxBuffer: 1 << 30 });
for (const [name, value] of secrets) if (history.includes(value)) report('git history', name);
const commits = execSync('git rev-list --all --count', { encoding: 'utf8' }).trim();

// What browsers download.
let bundled = 0;
if (process.argv.includes('--bundle')) {
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        bundled++;
        const text = readFileSync(full, 'latin1');
        for (const [secretName, value] of secrets) if (text.includes(value)) report(full, secretName);
      }
    }
  };
  for (const root of ['.next/static', 'public']) if (existsSync(root)) walk(root);
}

console.log(
  `${secrets.length} secrets checked against ${files.length} files, ${commits} commits${bundled ? ` and ${bundled} browser files` : ''}: ${problems === 0 ? 'nothing found' : `${problems} found`}`,
);
process.exit(problems === 0 ? 0 : 1);
