import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const findings = [];
const base = readJson('src-tauri/tauri.conf.json');
const production = readJson('src-tauri/tauri.production.conf.json');
const capability = readJson('src-tauri/capabilities/main.json');
const packageManifest = readJson('package.json');
const cargo = readText('src-tauri/Cargo.toml');
const rust = readText('src-tauri/src/lib.rs');

const allowedPermissions = new Set([
  'core:window:allow-is-minimized',
  'core:window:allow-is-visible',
  'core:window:allow-set-focus',
  'core:window:allow-show',
  'core:window:allow-unminimize',
  'notification:allow-is-permission-granted',
  'notification:allow-notify',
  'notification:allow-request-permission',
  'notification:allow-register-listener',
  'autostart:allow-disable',
  'autostart:allow-enable',
  'autostart:allow-is-enabled',
]);

check(base?.identifier === 'com.francescopuglia.lifetracker.beta', 'Beta identifier is not isolated.');
check(production?.identifier === 'com.francescopuglia.lifetracker', 'Production identifier is not exact.');
check(base?.productName === 'Life Tracker Beta', 'Beta product name is not distinguishable.');
check(production?.productName === 'Life Tracker', 'Production product name is not exact.');
check(base?.build?.frontendDist === '../out', 'Tauri frontendDist must use the reviewed static out directory.');
check(base?.build?.beforeBuildCommand === 'npm run build:desktop', 'Tauri must use the fail-closed Desktop export command.');
check(base?.build?.devUrl === 'http://127.0.0.1:3000', 'Tauri dev URL must be exact loopback.');
check(base?.build?.removeUnusedCommands === true, 'Unused Tauri commands must be removed.');
check(base?.app?.withGlobalTauri === false, 'Global Tauri injection must remain disabled.');
check(base?.app?.security?.freezePrototype === true, 'Tauri custom-protocol Object.prototype must be frozen.');
check(
  base?.app?.security?.dangerousDisableAssetCspModification === false,
  'Tauri CSP asset hardening must remain enabled.',
);
check(base?.app?.security?.assetProtocol?.enable === false, 'Tauri asset protocol must remain disabled.');
check(base?.app?.security?.capabilities?.length === 1 && base.app.security.capabilities[0] === 'main', 'Only the main capability may be loaded.');
check(base?.bundle?.active === true, 'Windows bundling must remain enabled.');
check(
  Array.isArray(base?.bundle?.targets) && base.bundle.targets.length === 1 && base.bundle.targets[0] === 'nsis',
  'Only the reviewed NSIS installer target may be built for R1.',
);
check(base?.bundle?.createUpdaterArtifacts === false, 'Updater artifacts must not be enabled during R1.');
check(base?.bundle?.icon?.every((path) => path.startsWith('icons-beta/')), 'Beta bundle must use visibly distinct icons.');
check(production?.bundle?.icon?.every((path) => path.startsWith('icons/')), 'Production bundle must use production icons.');

const exactJavaScriptPackages = {
  '@tauri-apps/api': '2.11.1',
  '@tauri-apps/plugin-notification': '2.3.3',
  '@tauri-apps/plugin-autostart': '2.5.1',
};
for (const [name, version] of Object.entries(exactJavaScriptPackages)) {
  check(packageManifest?.dependencies?.[name] === version, `${name} must remain pinned to ${version}.`);
}
check(packageManifest?.devDependencies?.['@tauri-apps/cli'] === '2.11.4', 'Tauri CLI must remain pinned to 2.11.4.');

for (const exactDependency of [
  'tauri = { version = "=2.11.5", features = ["tray-icon"] }',
  'tauri-build = { version = "=2.6.3", features = [] }',
  'tauri-plugin-notification = "=2.3.3"',
  'tauri-plugin-autostart = "=2.5.1"',
  'tauri-plugin-single-instance = "=2.4.3"',
]) {
  check(cargo.includes(exactDependency), `Pinned native dependency is missing: ${exactDependency}`);
}

validateCsp(base?.app?.security?.csp, 'life-tracker-staging');
validateCsp(production?.app?.security?.csp, 'life-tracker-12000');

check(capability?.local === true, 'Desktop capability must be local-only.');
check(!('remote' in (capability ?? {})), 'Remote sources must not receive native capabilities.');
check(
  Array.isArray(capability?.windows)
    && capability.windows.length === 1
    && capability.windows[0] === 'main',
  'Desktop capability must target only the exact main window.',
);
const permissions = capability?.permissions ?? [];
for (const permission of permissions) {
  check(typeof permission === 'string' && allowedPermissions.has(permission), `Unexpected native permission: ${String(permission)}`);
}
for (const permission of allowedPermissions) {
  check(permissions.includes(permission), `Required narrow native permission is missing: ${permission}`);
}

for (const forbidden of ['tauri-plugin-shell', 'tauri-plugin-fs', 'tauri-plugin-process', 'tauri-plugin-http']) {
  check(!cargo.includes(forbidden), `Forbidden native dependency present: ${forbidden}`);
}
check(!rust.includes('#[tauri::command]'), 'R1 must not add custom frontend-invokable Rust commands.');
check(rust.includes('tauri_plugin_single_instance::init'), 'Single-instance focus handling is missing.');
check(rust.includes('tauri_plugin_notification::init'), 'Native notification plugin is missing.');
check(rust.includes('tauri_plugin_autostart::init'), 'Autostart plugin is missing.');

if (findings.length) {
  console.error('Desktop security check failed:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log('Desktop security check passed.');
}

function validateCsp(csp, projectId) {
  check(typeof csp === 'string' && csp.length > 0, `${projectId} CSP is missing.`);
  if (typeof csp !== 'string') return;
  const endpoint = `https://europe-west1-${projectId}.cloudfunctions.net`;
  const otherProjectId = projectId === 'life-tracker-staging'
    ? 'life-tracker-12000'
    : 'life-tracker-staging';
  check(csp.includes(endpoint), `${projectId} CSP lacks its exact AI backend origin.`);
  check(!csp.includes(otherProjectId), `${projectId} CSP contains the other environment.`);
  check(csp.includes("object-src 'none'"), `${projectId} CSP must deny plugins/objects.`);
  check(csp.includes("base-uri 'self'"), `${projectId} CSP must constrain base URLs.`);
  check(csp.includes("frame-ancestors 'none'"), `${projectId} CSP must deny embedding.`);
  check(!csp.includes('*'), `${projectId} CSP must not contain wildcard sources.`);
  check(!csp.includes("'unsafe-eval'"), `${projectId} CSP must not permit unsafe eval.`);
}

function check(condition, message) {
  if (!condition) findings.push(message);
}

function readJson(path) {
  const text = readText(path);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    findings.push(`${path} is not valid JSON.`);
    return null;
  }
}

function readText(path) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) {
    findings.push(`${path} is missing.`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
}
