# Firestore Backup — Cloud Function Deployment Guide

**What this does:** Deploys a Cloud Function that exports the full Firestore
database to JSON, zips it, and uploads it to a Google Drive folder.
A Cloud Scheduler job triggers it automatically every Sunday at 3 AM.

**Who should run this:** Someone with Owner or Editor role on the GCP project
(needs permissions to deploy functions, create scheduler jobs, and manage IAM).

---

## Prerequisites

- `gcloud` CLI installed and authenticated (`gcloud auth login`)
- The correct project selected (`gcloud config set project PROJECT_ID`)
- These APIs enabled on the project (step 1 below enables them)

---

## Step 1: Enable required APIs

```bash
gcloud services enable \
  cloudfunctions.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com \
  drive.googleapis.com
```

---

## Step 2: Deploy the Cloud Function

Run this from the repository root (the folder containing `cloud_function/`):

```bash
gcloud functions deploy firestore-backup \
  --gen2 \
  --region=us-central1 \
  --runtime=python312 \
  --source=./cloud_function \
  --entry-point=backup_handler \
  --trigger-http \
  --no-allow-unauthenticated \
  --timeout=540 \
  --memory=512MB \
  --set-env-vars="GCP_PROJECT=bt-impact-academy,DRIVE_FOLDER_ID=REPLACE_DRIVE_FOLDER_ID"
```

**Replace before running:**
- `bt-impact-academy` → your GCP project ID
- `REPLACE_DRIVE_FOLDER_ID` → the Google Drive folder ID (the long string in
  the folder URL: `https://drive.google.com/drive/folders/THIS_PART`)

**Save the Function URL** from the output — you need it in step 4.

---

## Step 3: Grant the service account permission to invoke the function

The default service account needs the Cloud Functions Invoker role so that
Cloud Scheduler can trigger the function:

```bash
gcloud functions add-invoker-policy-binding firestore-backup \
  --region=us-central1 \
  --member="serviceAccount:bt-impact-academy@appspot.gserviceaccount.com"
```

---

## Step 4: Create the Cloud Scheduler job

```bash
gcloud scheduler jobs create http firestore-weekly-backup \
  --location=us-central1 \
  --schedule="0 3 * * 0" \
  --time-zone="Africa/Johannesburg" \
  --uri="REPLACE_FUNCTION_URL" \
  --http-method=POST \
  --oidc-service-account-email="bt-impact-academy@appspot.gserviceaccount.com"
```

**Replace before running:**
- `REPLACE_FUNCTION_URL` → the URL printed in step 2


---

## Step 5: Share the Google Drive folder with the service account

The Cloud Function uploads backups as its service account identity, not as a
human user. The service account needs Editor access to the target Drive folder.

1. Open the Drive folder in a browser
2. Click **Share**
3. Paste: `bt-impact-academy@appspot.gserviceaccount.com`
4. Set permission to **Editor**
5. Click Send

---

## Step 6: Test it manually

Trigger the function once to verify everything works:

```bash
gcloud scheduler jobs run firestore-weekly-backup --location=us-central1
```

Then check:
- **Cloud Function logs:** GCP Console → Cloud Functions → firestore-backup → Logs
- **Google Drive folder:** a new `.zip` file should appear within a few minutes

---

## What permissions are being granted (security summary)

| What | Permission | Why |
|---|---|---|
| Cloud Function's service account | Reads Firestore | To export the database |
| Cloud Function's service account | `drive.file` scope | To upload the zip (only files it creates, not full Drive access) |
| Cloud Scheduler | `cloudfunctions.invoker` on this function | To trigger the backup on schedule |

The `drive.file` scope is narrow — it only allows the service account to
manage files that it created itself. It cannot read, modify, or delete any
other files in the Drive account.

No new service accounts are created. This uses the project's existing default
App Engine service account.

---

## Restore script (for emergencies only)

A separate restore script (`firestore_restore.py` in the repo root) can write
a backup zip back into Firestore. It is **not automated** — an operator runs
it manually during a real incident.

### What the operator needs to run a restore

1. **Download the backup zip** from Google Drive (just click download in the
   browser — no API credentials needed for this part).

2. **Firestore write access** on their own Google account. They need one of:
   - `Cloud Datastore User` role (read + write Firestore, nothing else), OR
   - `Firebase Admin` role (broader, if they already have it)

   Grant this to the specific person(s) who would run a restore:

   ```bash
   gcloud projects add-iam-policy-binding bt-impact-academy \
     --member="user:OPERATOR_EMAIL@example.com" \
     --role="roles/datastore.user"
   ```

3. **Run the restore** (always do a dry run first):

   ```bash
   gcloud auth application-default login

   # Preview what would be written (no changes made):
   python firestore_restore.py --project bt-impact-academy \
       --zip ./backup_2026-09-07_030000.zip --dry-run

   # Actually restore:
   python firestore_restore.py --project bt-impact-academy \
       --zip ./backup_2026-09-07_030000.zip
   ```

   The script requires confirmation — the operator must type the project ID
   before it writes anything.

---

## Potential gotchas

- **App Engine app required:** Cloud Scheduler needs an App Engine app to exist
  in the project (even if unused). If step 4 fails with "App Engine app does
  not exist", create one: `gcloud app create --region=us-central1`

- **Billing:** Cloud Functions and Cloud Scheduler require billing to be enabled
  on the project.

- **Default service account Firestore access:** The App Engine default service
  account (`bt-impact-academy@appspot.gserviceaccount.com`) usually has
  Editor role, which includes Firestore read access. If your project has
  restricted IAM, verify it has at least `Cloud Datastore Viewer` role.

- **Region consistency:** The Cloud Function, Cloud Scheduler, and App Engine
  app should all use the same region (this guide uses `us-central1`).
