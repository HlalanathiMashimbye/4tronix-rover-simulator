// Exercises firestore.rules against the emulator over the REST API.
// Seeds with `Authorization: Bearer owner` (bypasses rules), then attempts each
// operation with no auth header, which is exactly what a browser is.
const P = 'demo-rules-test';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const BASE = `http://${HOST}/v1/projects/${P}/databases/(default)/documents`;

const asOwner = { 'Authorization': 'Bearer owner', 'Content-Type': 'application/json' };
const asClient = { 'Content-Type': 'application/json' };

const S = (v) => ({ stringValue: v });

async function seed(path, fields) {
  const r = await fetch(`${BASE}/${path}`, {
    method: 'PATCH', headers: asOwner, body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`seed ${path} failed: ${r.status} ${await r.text()}`);
}

/**
 * An unsigned JWT carrying custom claims.
 *
 * The emulator does not verify signatures, which is what lets these tests
 * exercise role-based rules without a real Firebase project or a signing key.
 * `alg: none` would be rejected by production and is the point: nothing here
 * can accidentally work against a live database.
 */
function tokenFor(claims) {
  const b64 = (o) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ alg: 'none', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const payload = b64({
    iss: `https://securetoken.google.com/${P}`,
    aud: P,
    auth_time: now,
    iat: now,
    exp: now + 3600,
    sub: claims.uid ?? 'test-uid',
    user_id: claims.uid ?? 'test-uid',
    firebase: { identities: {}, sign_in_provider: 'password' },
    ...claims,
  });
  return `${header}.${payload}.`;
}

/** No claims at all: exactly what a learner's browser sends. */
const ANON = undefined;
const LEARNER = { uid: 'learner-1' };
const OPERATOR = { uid: 'op-1', role: 'operator', yardIds: ['uct-rover-1'] };
const ADMIN = { uid: 'admin-1', role: 'admin', yardIds: ['uct-rover-1'] };

async function attempt(method, path, { body, mask, as } = {}) {
  let url = `${BASE}/${path}`;
  if (mask) url += `?` + mask.map((f) => `updateMask.fieldPaths=${f}`).join('&');
  const headers = { ...asClient };
  if (as) headers['Authorization'] = `Bearer ${tokenFor(as)}`;
  const r = await fetch(url, {
    method, headers,
    body: body ? JSON.stringify({ fields: body }) : undefined,
  });
  return r.status;
}

const results = [];
function check(label, status, want) {
  const allowed = status >= 200 && status < 300;
  const ok = want === 'ALLOW' ? allowed : !allowed;
  results.push({ label, want, got: allowed ? 'ALLOW' : `DENY(${status})`, ok });
}

// --- seed -------------------------------------------------------------------
const HASH = 'b'.repeat(64);
const OTHER_HASH = 'c'.repeat(64);
await seed('missions/m_no_email', { name: S('Blank'), code: S('forward(50)'), status: S('queued') });
await seed('missions/m_has_email', { name: S('Taken'), code: S('forward(50)'), status: S('queued'), learnerEmailHash: S(HASH) });
await seed('missions/m_no_email2', { name: S('Blank2'), code: S('forward(50)'), status: S('queued') });
await seed('learners/L1', { learnerEmail: S('a@b.com'), displayName: S('Ada') });
await seed('missions/m_no_email/runs/uct-rover-1', { status: S('completed'), youtubeUrl: S('https://youtu.be/x') });
await seed('missions/m_no_email/audit/e1', { actor: S('op-1'), action: S('dispatch') });
await seed('users/u1', { role: S('operator'), email: S('op@example.com') });

// --- missions ---------------------------------------------------------------
check('mission: public read (feed)', await attempt('GET', 'missions/m_no_email'), 'ALLOW');
check('mission: list (feed query)', await attempt('GET', 'missions'), 'ALLOW');
check('mission: delete blocked', await attempt('DELETE', 'missions/m_no_email'), 'DENY');
check('mission: create blocked', await attempt('POST', 'missions?documentId=m_new', { name: S('x') }), 'DENY');
// updateDoc() in the web SDK always sends an updateMask; a maskless PATCH
// would replace the whole document, which is not what the app ever does.
check('mission: backfill hash into blank', await attempt('PATCH', 'missions/m_no_email', { body: { learnerEmailHash: S(HASH) }, mask: ['learnerEmailHash'] }), 'ALLOW');
check('mission: overwrite existing hash blocked', await attempt('PATCH', 'missions/m_has_email', { body: { learnerEmailHash: S(OTHER_HASH) }, mask: ['learnerEmailHash'] }), 'DENY');
check('mission: plaintext address as hash blocked', await attempt('PATCH', 'missions/m_no_email2', { body: { learnerEmailHash: S('ada@school.edu') }, mask: ['learnerEmailHash'] }), 'DENY');
check('mission: plaintext learnerEmail field blocked', await attempt('PATCH', 'missions/m_no_email2', { body: { learnerEmail: S('ada@school.edu') }, mask: ['learnerEmail'] }), 'DENY');
check('mission: tamper with code blocked', await attempt('PATCH', 'missions/m_has_email', { body: { code: S('import os') }, mask: ['code'] }), 'DENY');
check('mission: tamper with status blocked', await attempt('PATCH', 'missions/m_no_email', { body: { status: S('completed') }, mask: ['status'] }), 'DENY');

// --- learners ---------------------------------------------------------------
check('learner: get own doc by id', await attempt('GET', 'learners/L1'), 'ALLOW');
check('learner: LIST (enumerate all emails) blocked', await attempt('GET', 'learners'), 'DENY');
check('learner: delete blocked', await attempt('DELETE', 'learners/L1'), 'DENY');
// learnerEmail is absent from the update allowlist, so a browser can neither
// set nor clear one. This asserted ALLOW and had been failing since the
// address moved to the private subcollection; nothing ran it to notice.
check('learner: write email from browser blocked', await attempt('PATCH', 'learners/L1', { body: { learnerEmail: S('c@d.com') }, mask: ['learnerEmail'] }), 'DENY');
check('learner: clearing email from browser blocked', await attempt('PATCH', 'learners/L1', { body: { learnerEmail: { nullValue: null } }, mask: ['learnerEmail'] }), 'DENY');
check('learner: update displayName allowed', await attempt('PATCH', 'learners/L1', { body: { displayName: S('Grace') }, mask: ['displayName'] }), 'ALLOW');
check('learner: arbitrary field blocked', await attempt('PATCH', 'learners/L1', { body: { junk: S('payload') }, mask: ['junk'] }), 'DENY');

// --- runs (the run model) ---------------------------------------------------
// Public read matches the mission itself: a learner has to see which yards ran
// their program and which produced a video.
check('run: public read', await attempt('GET', 'missions/m_no_email/runs/uct-rover-1'), 'ALLOW');
check('run: list for a mission', await attempt('GET', 'missions/m_no_email/runs'), 'ALLOW');
check('run: browser write blocked', await attempt('PATCH', 'missions/m_no_email/runs/uct-rover-1', { body: { status: S('completed') }, mask: ['status'] }), 'DENY');
check('run: operator cannot write directly', await attempt('PATCH', 'missions/m_no_email/runs/uct-rover-1', { body: { status: S('completed') }, mask: ['status'], as: OPERATOR }), 'DENY');

// Any OTHER mission subcollection is denied outright. The previous catch-all
// allowed read on all of them, so an audit trail naming which operator
// dispatched what would have been world-readable the day it was created.
check('mission audit: read blocked (anon)', await attempt('GET', 'missions/m_no_email/audit/e1'), 'DENY');
check('mission audit: read blocked (operator)', await attempt('GET', 'missions/m_no_email/audit/e1', { as: OPERATOR }), 'DENY');

// --- roles come from the claim, not a document ------------------------------
check('users: anon read blocked', await attempt('GET', 'users/u1'), 'DENY');
check('users: learner read blocked', await attempt('GET', 'users/u1', { as: LEARNER }), 'DENY');
check('users: operator read blocked', await attempt('GET', 'users/u1', { as: OPERATOR }), 'DENY');
check('users: admin read allowed', await attempt('GET', 'users/u1', { as: ADMIN }), 'ALLOW');
check('users: write blocked even for admin', await attempt('PATCH', 'users/u1', { body: { role: S('admin') }, mask: ['role'], as: ADMIN }), 'DENY');

// The attack the claim change closes: writing yourself a users/{uid} document
// no longer grants anything, because nothing reads roles from there.
check('users: self-granting a role is inert', await attempt('PATCH', 'users/learner-1', { body: { role: S('admin') }, mask: ['role'], as: LEARNER }), 'DENY');

// --- unmatched collections --------------------------------------------------
check('unknown collection: write blocked', await attempt('PATCH', 'anything/x', { body: { a: S('b') }, mask: ['a'] }), 'DENY');
check('unknown collection: admin write still blocked', await attempt('PATCH', 'anything/y', { body: { a: S('b') }, mask: ['a'], as: ADMIN }), 'DENY');

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
console.log('\n' + pad('CHECK', 46) + pad('WANT', 8) + 'GOT');
console.log('-'.repeat(74));
for (const r of results) {
  console.log((r.ok ? '  ' : 'XX') + ' ' + pad(r.label, 43) + pad(r.want, 8) + r.got);
}
const failed = results.filter((r) => !r.ok);
console.log('-'.repeat(74));
console.log(`${results.length - failed.length}/${results.length} as intended`);
if (failed.length) { console.log('FAILURES: ' + failed.map((f) => f.label).join('; ')); process.exit(1); }
