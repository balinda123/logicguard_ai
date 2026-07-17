const requiredMajor = 22;
const requiredMinor = 12;
const current = process.versions.node;
const [major, minor] = current.split('.').map((part) => Number(part));

const supported =
  major === requiredMajor && Number.isFinite(minor) && minor >= requiredMinor;

if (!supported) {
  console.error('');
  console.error('LogicGuard AI requires Node.js >=22.12.0 and <23.');
  console.error(`Current Node.js version: ${current}`);
  console.error('');
  console.error('Please switch to Node 22 LTS, then run:');
  console.error('  npm ci');
  console.error('  npm run tauri dev');
  console.error('');
  process.exit(1);
}
