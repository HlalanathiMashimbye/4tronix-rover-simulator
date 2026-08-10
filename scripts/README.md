# scripts/

Cross-platform Node launchers used by the root `npm run dev` commands. They
resolve ports and interpreters so the same commands work on Windows, macOS and
Linux.

| Script | Used by | What it does |
|--------|---------|--------------|
| `dev-launcher.js` | `npm run dev` / `npm run dev:all` | Starts the full stack (hub + satellite + rover), waits for the web ports, and opens the browser pages. |
| `dev-satellite.js` | `npm run dev:satellite` | Launches the yard satellite web server, resolving the project virtualenv (`.venv`) or a system Python. |
| `dev-yard.js` | `npm run dev:yard` | Launches the yard rover server the same way (replaces the old POSIX-only shell command). |
| `free-port.js` | `dev-launcher.js`, `dev:control` | Frees ports 3000/3001/8523 held by stale dev servers before restart. Only kills processes that look like this repo's dev stack. |
| `firestore-rules-test.mjs` | manual / CI | Exercises `firestore.rules` against the Firestore emulator over the REST API, seeding as owner then attempting each operation unauthenticated (what a browser is). |

Run everything from the repo root:

```bash
npm run dev            # full stack
npm run dev:satellite  # satellite only
npm run dev:yard       # rover server only
```
