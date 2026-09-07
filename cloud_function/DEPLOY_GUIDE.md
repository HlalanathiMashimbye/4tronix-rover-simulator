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
  --set-env-vars="GCP_PROJECT=REPLACE_PROJECT_ID,DRIVE_FOLDER_ID=REPLACE_DRIVE_FOLDER_ID"
```

**Replace before running:**
- `REPLACE_PROJECT_ID` → your GCP project ID
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
  --member="serviceAccount:REPLACE_PROJECT_ID@appspot.gserviceaccount.com"
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
  --oidc-service-account-email="REPLACE_PROJECT_ID@appspot.gserviceaccount.com"
```

**Replace before running:**
- `REPLACE_FUNCTION_URL` → the URL printed in step 2
- `REPLACE_PROJECT_ID` → your GCP project ID

---

## Step 5: Share the Google Drive folder with the service account

The Cloud Function uploads backups as its service account identity, not as a
human user. The service account needs Editor access to the target Drive folder.

1. Open the Drive folder in a browser
2. Click **Share**
3. Paste: `REPLACE_PROJECT_ID@appspot.gserviceaccount.com`
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
