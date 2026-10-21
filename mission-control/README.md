# Mars Rover Mission Control

A learner-focused platform for authoring and testing Mars rover missions. Learners drive a simulated rover manually, snap Blockly blocks together, or write Python against the real rover API, preview the run in the built-in 2D simulator, and submit the mission for execution on a physical 4tronix M.A.R.S. rover. Operators sign in to the same app to work the queue for their yard and settle each run afterwards.

## Prerequisites

- Node.js 20.9+ (the minimum Next 16 supports)
- npm 9+
- A Firebase project with Firestore and Authentication enabled

## Getting Started

1. Install dependencies:

```bash
cd mission-control
npm install
```

2. Create your environment file from the template and fill in your Firebase config:

```bash
cp .env.example .env
```

The client-side `NEXT_PUBLIC_FIREBASE_*` values come from your Firebase project settings. Everything without the `NEXT_PUBLIC_` prefix is server-side only. The server reaches Firebase with Application Default Credentials (`gcloud auth application-default login`), never a service-account key. Never commit real credentials; `.env` is gitignored.

3. Start the dev server:

```bash
npm run dev
```

The app runs at `http://localhost:3000`.

## Scripts

- `npm run dev` - development server (port 3000)
- `npm run build` / `npm start` - production build and serve
- `npm run lint` - ESLint
- `npm test` - Jest unit and integration tests

## Routes

- `/` - landing page with the mission feed
- `/mission` - the mission workspace (manual drive, Blockly, and Python editors plus the simulator)
- `/history` - the learner's own mission history
- `/missions/[missionId]` - mission detail with run video and code viewer
- `/operator` - operator sign-in, then the live queue for the yard the operator signed in at
- `/operator/team` - admins only: grant and remove operator access
- `/operator/settings` - admins only: email sending, the YouTube key and channel, how often uploads are checked, and the yards

Learners are anonymous and never sign in. Nothing a learner can see links to `/operator`: it is reachable by URL only and marked `noindex`. Hiding it is not the security control; the session check described below is.

## Project Structure

- `src/app/` - Next.js pages and API routes
- `src/components/` - React components (editors, simulator, workspace, layout, the operator console)
- `src/contexts/` - React context providers (learner session, search, theme, analytics)
- `src/hooks/` - small React hooks (favourites, completion notifications, sound)
- `src/core/` - domain entities, the safety rules (code allowlist, time and speed ceilings), and application services
- `src/infrastructure/` - Firestore, Firebase Auth, email, YouTube and runtime settings, plus the composition roots
- `src/lib/` - small helpers, and the five simulator modules shared with the yard (see `src/lib/README.md`)
- `src/proxy.ts` - an optimistic gate for operator pages and APIs: it turns away requests with no session cookie, and `src/infrastructure/auth/dal.ts` does the real check

## How It Works

1. Learners build a mission in the workspace: driving manually records commands, and the Blockly and Python editors generate rover code.
2. The in-browser 2D simulator previews the trajectory before submission.
3. Submitted code passes an AST-based allowlist check so only approved rover commands reach the queue.
4. Missions are stored in Firestore. At a yard, an operator copies one from `/operator` and pastes it into the yard satellite's run station, which records the run while the rover drives it.
5. The operator can upload the video through YouTube Studio as before, or the configured satellite uploader can send the finished recording to YouTube automatically. The operator marks the run complete here; a scheduled job then finds the upload and attaches it to the run, and the learner sees it on the mission page.

## The Operator Console

Operators use this app, at `/operator`. The yard satellite (`yard/satellite/`) has no sign-in and no console of its own: it is the yard's control panel, where missions are pasted in, run and recorded. The operator carries each mission to the yard; when automatic uploading is configured, the satellite has a separate outbound path to send a completed recording to Mission Control.

- **Signing in.** Firebase Auth, then `/api/auth/session` exchanges the ID token for a session cookie. The operator chooses their yard as they sign in, and it stays fixed for the session.
- **Roles.** `operator` or `admin`, a custom claim on the Firebase token; `firestore.rules` reads the same claim. `src/proxy.ts` only checks that a session cookie is present. `src/infrastructure/auth/dal.ts` verifies it, revocation included, on every operator page and route.
- **The queue.** A live Firestore listener on the missions for the operator's yard. **Copy** puts the mission's Python on the clipboard under `# Mission:` and `# MissionID:` header comments, which the run station reads to name the run and its recording.
- **Settling a run.** Complete, cancel, log another run, attach or remove a video, resolve a review, and leave feedback. None of these reaches a rover: sending, stopping and the camera stay on the satellite, because they are physical and stop has to work with no internet. Deleting a mission is admin-only.
- **Admin pages.** `/operator/team` grants and removes operator access; the first admin on a fresh project comes from `scripts/set-operator-role.mjs` (see `docs/RUNBOOK.md`). `/operator/settings` holds the configuration that used to need a Terraform run: the Resend key and sending address, the YouTube key and channel, the auto-link interval, and the yards.
- **Attaching videos automatically.** Cloud Scheduler calls `POST /api/cron/youtube-link` with a shared secret, every 15 minutes by default. It reads the channel's 50 most recent uploads, matches the `MissionID:` and `Yard:` lines the run station put in each description, and attaches the video to that yard's run once the run is marked complete. A call only reads YouTube when the interval set on `/operator/settings` (default 15 minutes) has passed since the last check.
- **Uploading recordings automatically (optional).** When the satellite's rover-history watcher confirms a dispatched run ended, it closes and keeps the MP4 and leaves a delivery note beside it (`<file>.mp4.upload.json`). Every watcher pass sends what is due to `POST /api/youtube-upload/recording`, and the note stays until Mission Control has the video or answers that it never will, so a satellite serving the yard's wifi, which has no internet, sends its videos the next time it has a way out. Retries start a minute apart and stop doubling at half an hour. Mission Control uploads it with the YouTube Data API; a separate private Firestore ledger records its mission, rover dispatch ID, yard, bounded attempts and result. Then the video goes onto its run through the same linker the scheduled poll uses, which closes an open run and emails the learner, as a found video does. Not for a run the rover reported as an error: that one is left for the operator, with the video in its upload row. An upload failure never changes mission status or removes the recording; operators can always use the existing download, YouTube Studio and add/replace/remove-link controls as before. Automatic upload is disabled until both YouTube OAuth and the satellite-ingest credential are configured. The endpoint accepts recordings up to 30 MiB (Cloud Run's request-body limit); larger recordings remain available for the manual process.

### YouTube upload authorization and configuration

Automatic uploads use a dedicated Google **Web application OAuth client** and
the YouTube Data API v3. This is separate from Firebase Authentication, which
continues to sign operators into Mission Control. Do not edit or reuse the
Firebase Google OAuth client.

Register these exact Authorized redirect URIs on the YouTube OAuth client
(register the environments you operate):

```text
http://localhost:3000/api/operator/youtube-oauth/callback
https://marsyard.labs.ws/api/operator/youtube-oauth/callback
https://marsyard.sapient.rocks/api/operator/youtube-oauth/callback
```

The callback URI is computed from the validated `APP_URL` runtime origin (with
`NEXT_PUBLIC_APP_URL` as the local fallback) plus
`/api/operator/youtube-oauth/callback`. Production and staging origins are
provided by the deployment configuration. Local development must use
`http://localhost:3000`; non-local origins require HTTPS.

In Google Cloud, enable **YouTube Data API v3**, create a Web application
OAuth client, and set `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` in the
admin-only Run videos settings (or as local server-only environment overrides).
An admin starts authorization from `/operator/settings`; Google grants only
`https://www.googleapis.com/auth/youtube.upload` with offline access. The
callback stores the refresh token in Secret Manager and never returns it to the
browser. On first authorization, the token is only saved when none exists.
Replacing a working token requires the explicit **Replace YouTube
authorization** action. If `YOUTUBE_REFRESH_TOKEN` is set in the process
environment, it takes precedence and must be updated there deliberately.

**Pick the privacy before the first upload.** A private video is attached to
its run like any other, but a learner cannot play it, so the mission page
shows a video nobody can watch. Unlisted plays for anyone with the link and
stays out of search.

The app's OAuth settings are `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`,
`YOUTUBE_REFRESH_TOKEN`, `YOUTUBE_UPLOAD_PRIVACY` (`private` by default),
`YOUTUBE_MADE_FOR_KIDS` (`false` by default), and the shared
`YOUTUBE_UPLOAD_INGEST_SECRET`. The last value authenticates the satellite to
Mission Control; it is not a YouTube token. Terraform generates and mounts it
in Cloud Run. Copy that same value into `yard/satellite/.env` as
`YOUTUBE_UPLOAD_INGEST_SECRET`, and point the yard at the matching Mission
Control on the satellite's Settings page (the link button beside power;
`marsyard.sapient.rocks` unless changed). Keep both `.env` files out of
version control.
The client ID, client secret and refresh token are server-side only; in
production they use the existing Secret Manager-backed admin settings. OAuth
client ID/secret and upload privacy/kids settings must be provisioned in
Secret Manager as part of Terraform before the settings page can save them.

For local development, use the localhost callback above, set the client ID and
secret in `mission-control/.env`, and set the same locally generated
`YOUTUBE_UPLOAD_INGEST_SECRET` in both Mission Control and the satellite
`.env` files. Generate a local-only value with
`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
Authenticate local Secret Manager access with ADC, then sign in
to an admin account and authorize YouTube from `/operator/settings`. Do not
put a refresh token in `NEXT_PUBLIC_*` variables or browser code. For a
deployment, Terraform provisions the runtime secrets; set the OAuth client
values in admin settings, then authorize from the corresponding deployed
`/operator/settings` URL and copy the generated ingest secret to the satellite
through the normal secure operations channel. No YouTube credential is stored
on the satellite.

## Rover Python API

The Python editor targets the real rover's low-level API, for example:

```python
import rover
import time

rover.init(0)
rover.forward(50)
time.sleep(1)
rover.stop()
rover.setServo(0, 30)
```

## Testing

`npm test` runs the Jest suite (unit tests for the domain services, parsers, and sandbox plus integration tests for the API routes).
