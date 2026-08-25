import { randomBytes } from 'node:crypto';
import { DomainError } from '../domain/errors';

export interface McpFirebaseWebConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly appId: string;
}

export interface McpAuthorizationPage {
  readonly html: string;
  readonly contentSecurityPolicy: string;
}

export function parseMcpFirebaseWebConfig(value: string): McpFirebaseWebConfig {
  let input: unknown;
  try {
    input = JSON.parse(value) as unknown;
  } catch {
    throw new DomainError('INTERNAL', 'MCP Firebase web configuration is invalid.');
  }
  if (!isRecord(input)) {
    throw new DomainError('INTERNAL', 'MCP Firebase web configuration is invalid.');
  }
  return validateMcpFirebaseWebConfig(input);
}

function validateMcpFirebaseWebConfig(
  input: object,
): McpFirebaseWebConfig {
  const value = input as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) =>
    !['apiKey', 'authDomain', 'projectId', 'appId'].includes(key))) {
    throw new DomainError('INTERNAL', 'MCP Firebase web configuration is invalid.');
  }
  const apiKey = configString(value.apiKey, 256);
  const authDomain = configString(value.authDomain, 253);
  const projectId = configString(value.projectId, 128);
  const appId = configString(value.appId, 256);
  if (
    !/^[A-Za-z0-9_-]{4,128}$/.test(projectId)
    || authDomain !== `${projectId}.firebaseapp.com`
    || !/^[A-Za-z0-9.-]+$/.test(authDomain)
    || !/^AIza[A-Za-z0-9_-]{16,252}$/.test(apiKey)
    || !/^[A-Za-z0-9:_-]{4,256}$/.test(appId)
  ) throw new DomainError('INTERNAL', 'MCP Firebase web configuration is invalid.');
  return Object.freeze({ apiKey, authDomain, projectId, appId });
}

export function createMcpAuthorizationPage(input: Readonly<{
  firebaseConfig: McpFirebaseWebConfig;
  pendingId: string;
  csrfToken: string;
  completeUrl: string;
  denyUrl: string;
  expiresAt: string;
}>): McpAuthorizationPage {
  assertHttpsSameOrigin(input.completeUrl, input.denyUrl);
  if (
    !/^ltmcp_pd_[A-Za-z0-9_-]{43}$/.test(input.pendingId)
    || !/^ltmcp_cs_[A-Za-z0-9_-]{43}$/.test(input.csrfToken)
    || !Number.isFinite(Date.parse(input.expiresAt))
  ) throw new DomainError('INTERNAL', 'MCP authorization page state is invalid.');
  const firebaseConfig = validateMcpFirebaseWebConfig(input.firebaseConfig);
  const nonce = randomBytes(18).toString('base64url');
  const boot = safeJson({
    firebaseConfig,
    pendingId: input.pendingId,
    csrfToken: input.csrfToken,
    completeUrl: input.completeUrl,
    denyUrl: input.denyUrl,
  });
  const authOrigin = `https://${firebaseConfig.authDomain}`;
  const contentSecurityPolicy = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' https://www.gstatic.com`,
    `style-src 'nonce-${nonce}'`,
    `connect-src 'self' ${authOrigin} https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://*.googleapis.com`,
    `frame-src ${authOrigin} https://accounts.google.com https://apis.google.com`,
    "img-src data: https:",
    "font-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Connect Life Tracker</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0d1117; color: #f0f6fc; }
    main { width: min(92vw, 440px); padding: 28px; border: 1px solid #30363d; border-radius: 16px; background: #161b22; box-shadow: 0 18px 60px #0008; }
    h1 { margin: 0 0 12px; font-size: 1.5rem; }
    p { line-height: 1.5; color: #b1bac4; }
    .scope { padding: 12px; border-radius: 10px; background: #0d1117; border: 1px solid #30363d; }
    label { display: block; margin: 12px 0 6px; }
    input { box-sizing: border-box; width: 100%; padding: 11px 12px; border-radius: 8px; border: 1px solid #484f58; background: #0d1117; color: inherit; }
    button { width: 100%; margin-top: 12px; padding: 11px 14px; border: 0; border-radius: 8px; font-weight: 650; cursor: pointer; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .primary { background: #2f81f7; color: #fff; }
    .secondary { background: #30363d; color: #f0f6fc; }
    .deny { background: transparent; color: #b1bac4; border: 1px solid #484f58; }
    #status { min-height: 24px; font-size: .92rem; }
    .fine { font-size: .8rem; }
  </style>
</head>
<body>
  <main>
    <h1>Connect ChatGPT to Life Tracker</h1>
    <p class="scope"><strong>Read-only access:</strong> Goals, Projects, Tasks, TimeBlocks, Sessions, Habits, deterministic KPIs, and scientific reports. No tool can create, update, delete, apply, or roll back data.</p>
    <p>Sign in through Firebase, then explicitly approve this private connection. Your password goes directly to Firebase Authentication and is never sent to the Life Tracker backend.</p>
    <button id="google" class="secondary" type="button">Continue with Google</button>
    <form id="email-form" autocomplete="on">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="username" required maxlength="320">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required maxlength="4096">
      <button class="secondary" type="submit">Sign in with email</button>
    </form>
    <p id="status" role="status" aria-live="polite">Waiting for Firebase sign-in.</p>
    <button id="approve" class="primary" type="button" disabled>Approve read-only access</button>
    <button id="deny" class="deny" type="button">Cancel</button>
    <p class="fine">This request expires at ${escapeHtml(input.expiresAt)}. Closing this page grants nothing.</p>
  </main>
  <script type="module" nonce="${nonce}">
    import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
    import {
      browserSessionPersistence,
      getAuth,
      GoogleAuthProvider,
      onAuthStateChanged,
      setPersistence,
      signInWithEmailAndPassword,
      signInWithPopup
    } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';

    const boot = ${boot};
    const app = initializeApp(boot.firebaseConfig);
    const auth = getAuth(app);
    const status = document.getElementById('status');
    const approve = document.getElementById('approve');
    const google = document.getElementById('google');
    const emailForm = document.getElementById('email-form');
    const deny = document.getElementById('deny');
    let activeUser = null;

    const setBusy = (busy) => {
      approve.disabled = busy || !activeUser;
      google.disabled = busy;
      deny.disabled = busy;
      for (const element of emailForm.elements) element.disabled = busy;
    };
    const fail = () => {
      status.textContent = 'The connection could not be completed. Check your sign-in and try again.';
      setBusy(false);
    };

    await setPersistence(auth, browserSessionPersistence);
    onAuthStateChanged(auth, (user) => {
      activeUser = user;
      status.textContent = user
        ? 'Firebase identity verified locally. Review the scope and approve.'
        : 'Waiting for Firebase sign-in.';
      setBusy(false);
    });

    google.addEventListener('click', async () => {
      setBusy(true);
      status.textContent = 'Opening Firebase sign-in…';
      try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
      } catch { fail(); }
    });

    emailForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      setBusy(true);
      status.textContent = 'Signing in through Firebase…';
      try {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        await signInWithEmailAndPassword(auth, email, password);
        document.getElementById('password').value = '';
      } catch {
        document.getElementById('password').value = '';
        fail();
      }
    });

    approve.addEventListener('click', async () => {
      if (!activeUser) return;
      setBusy(true);
      status.textContent = 'Authorizing read-only access…';
      try {
        const firebaseIdToken = await activeUser.getIdToken(true);
        const response = await fetch(boot.completeUrl, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'content-type': 'application/json',
            'x-life-tracker-csrf': boot.csrfToken
          },
          body: JSON.stringify({
            pendingId: boot.pendingId,
            firebaseIdToken
          })
        });
        const result = await response.json();
        if (!response.ok || typeof result.redirectUrl !== 'string') throw new Error('authorization failed');
        window.location.assign(result.redirectUrl);
      } catch { fail(); }
    });

    deny.addEventListener('click', async () => {
      setBusy(true);
      status.textContent = 'Cancelling…';
      try {
        const response = await fetch(boot.denyUrl, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'content-type': 'application/json',
            'x-life-tracker-csrf': boot.csrfToken
          },
          body: JSON.stringify({ pendingId: boot.pendingId })
        });
        const result = await response.json();
        if (!response.ok || typeof result.redirectUrl !== 'string') throw new Error('cancel failed');
        window.location.assign(result.redirectUrl);
      } catch { fail(); }
    });
  </script>
</body>
</html>`;
  return Object.freeze({ html, contentSecurityPolicy });
}

function assertHttpsSameOrigin(first: string, second: string): void {
  let firstUrl: URL;
  let secondUrl: URL;
  try {
    firstUrl = new URL(first);
    secondUrl = new URL(second);
  } catch {
    throw new DomainError('INTERNAL', 'MCP authorization endpoint is invalid.');
  }
  if (
    firstUrl.protocol !== 'https:'
    || secondUrl.protocol !== 'https:'
    || firstUrl.origin !== secondUrl.origin
    || firstUrl.username
    || firstUrl.password
    || secondUrl.username
    || secondUrl.password
    || firstUrl.search
    || firstUrl.hash
    || secondUrl.search
    || secondUrl.hash
    || !firstUrl.pathname.endsWith('/authorize/complete')
    || !secondUrl.pathname.endsWith('/authorize/deny')
  ) throw new DomainError('INTERNAL', 'MCP authorization endpoint is invalid.');
}

function configString(value: unknown, maximum: number): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) throw new DomainError('INTERNAL', 'MCP Firebase web configuration is invalid.');
  return value;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
