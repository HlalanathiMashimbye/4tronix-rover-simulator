/**
 * The deploy smoke check, run for real against a server that misbehaves on
 * purpose.
 *
 * WHY THIS FILE EXISTS. scripts/smoke-check.sh is the only thing that looks at
 * a deployed Mission Control and asks whether the operator console is still
 * behind sign-in. Its passing path runs on every staging deploy. Its failing
 * paths had never run anywhere: nothing had ever served it a leaked console or
 * an open operator API, so there was no evidence it would notice either. A
 * check that has only ever passed is not yet known to be a check.
 *
 * Each case below serves a deployment that differs from a healthy one in
 * exactly one answer, so a non-zero exit can only mean that answer was caught.
 * Nothing here reads the script's messages: the exit status is what fails a
 * deploy, and the wording is free to change.
 */

import { execFile } from 'child_process';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { join } from 'path';

const SCRIPT = join(__dirname, '..', '..', '..', '..', 'scripts', 'smoke-check.sh');

type Routes = Record<string, { status: number; body?: string }>;

const SIGN_IN = '<form><input type="email"><input type="password"><button>Sign in</button></form>';

/** What a correctly deployed Mission Control answers an anonymous caller. */
const healthy: Routes = {
  '/': { status: 200, body: '<h1>Missions</h1>' },
  '/operator': { status: 200, body: SIGN_IN },
  '/api/operator/missions': { status: 401, body: '{"error":"Not signed in"}' },
};

let server: Server;
let serving: Routes = healthy;
let base = '';

beforeAll((done) => {
  server = createServer((req, res) => {
    const route = serving[req.url ?? ''] ?? { status: 404 };
    res.writeHead(route.status, { 'content-type': 'text/html' });
    res.end(route.body ?? '');
  }).listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

/** Runs the script against `routes` and resolves with its exit status. */
function smokeCheck(routes: Routes, url = base): Promise<number> {
  serving = routes;
  return new Promise((resolve, reject) => {
    execFile('bash', [SCRIPT, url], (error) => {
      if (!error) return resolve(0);
      // A string code is the spawn failing (no bash), not the check failing.
      return typeof error.code === 'number' ? resolve(error.code) : reject(error);
    });
  });
}

// The script is bash, written for the Actions runner and a developer's Mac or
// Linux machine. CI is where this has to hold.
const suite = process.platform === 'win32' ? describe.skip : describe;

suite('scripts/smoke-check.sh', () => {
  it('passes a deployment with the operator console behind sign-in', async () => {
    expect(await smokeCheck(healthy)).toBe(0);
  });

  it('passes the same deployment given its URL with a trailing slash', async () => {
    expect(await smokeCheck(healthy, `${base}/`)).toBe(0);
  });

  it('fails when the learner home does not serve', async () => {
    expect(await smokeCheck({ ...healthy, '/': { status: 503 } })).toBe(1);
  });

  it('fails when /operator is a 404, which the old check demanded', async () => {
    // Served with the sign-in form on purpose. With an empty body the missing
    // password field failed this case, and the status check could be deleted
    // from the script without any test noticing.
    const missing = { status: 404, body: SIGN_IN };

    expect(await smokeCheck({ ...healthy, '/operator': missing })).toBe(1);
  });

  it('fails when /operator answers 200 with something that is not sign-in', async () => {
    // What Cloud Run's placeholder does before the first real deploy: every
    // path is a 200, so a status check alone would wave it through.
    const placeholder = { status: 200, body: '<title>Congratulations | Cloud Run</title>' };

    expect(await smokeCheck({ ...healthy, '/operator': placeholder })).toBe(1);
  });

  it('fails when the console itself reaches an anonymous visitor', async () => {
    // Still has a password field somewhere on the page, so only the console
    // content can give it away.
    const leaked = { status: 200, body: `${SIGN_IN}<h2>Mission queue</h2>` };

    expect(await smokeCheck({ ...healthy, '/operator': leaked })).toBe(1);
  });

  it('fails when the operator API answers an anonymous caller', async () => {
    const open = { status: 200, body: '[]' };

    expect(await smokeCheck({ ...healthy, '/api/operator/missions': open })).toBe(1);
  });

  it('refuses to run without a URL, rather than checking nothing', async () => {
    expect(await smokeCheck(healthy, '')).toBe(2);
  });
});
