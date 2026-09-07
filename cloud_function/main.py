"""
Cloud Function: Firestore Backup to Google Drive

Triggered by HTTP (from Cloud Scheduler). Exports the full Firestore
database to JSON files, zips them, and uploads the zip to Google Drive.

Environment variables (set in the Cloud Function config):
    GCP_PROJECT       – Firestore project ID
    DRIVE_FOLDER_ID   – Google Drive folder to upload the zip into
"""

import datetime
import json
import os
import shutil
import sys
import traceback

import firebase_admin
from firebase_admin import credentials, firestore

import google.auth
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"]


# ---------------------------------------------------------------------------
# Firestore export logic (unchanged from firestore_backup.py)
# ---------------------------------------------------------------------------

def serialize_value(value):
    """Convert Firestore-specific field types into plain JSON-safe values."""
    if isinstance(value, datetime.datetime):
        return value.isoformat()
    if isinstance(value, firestore.GeoPoint):
        return {"__type__": "geopoint", "latitude": value.latitude, "longitude": value.longitude}
    if isinstance(value, firestore.DocumentReference):
        return {"__type__": "reference", "path": value.path}
    if isinstance(value, dict):
        return {k: serialize_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [serialize_value(v) for v in value]
    return value


def export_document(doc_snapshot, doc_ref, out_dir):
    data = {k: serialize_value(v) for k, v in (doc_snapshot.to_dict() or {}).items()}
    doc_dir = os.path.join(out_dir, doc_snapshot.id)
    os.makedirs(doc_dir, exist_ok=True)
    with open(os.path.join(doc_dir, "_document.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)
    for subcol in doc_ref.collections():
        export_collection(subcol, os.path.join(doc_dir, subcol.id))


def export_collection(col_ref, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    docs = list(col_ref.stream())
    print(f"  Collection '{col_ref.id}': {len(docs)} documents")
    for snapshot in docs:
        doc_ref = col_ref.document(snapshot.id)
        export_document(snapshot, doc_ref, out_dir)


# ---------------------------------------------------------------------------
# Drive upload (auth changed: service account via ADC instead of browser OAuth)
# ---------------------------------------------------------------------------

def get_drive_service():
    """Build a Drive API client using the Cloud Function's service account.

    In the original script this opened a browser for OAuth consent.
    Here we use Application Default Credentials (ADC), which means the
    Cloud Function's own service account identity -- no browser, no
    token file, no human interaction needed.
    """
    creds, _ = google.auth.default(scopes=DRIVE_SCOPES)
    return build("drive", "v3", credentials=creds)


def upload_to_drive(zip_path, folder_id, drive_service):
    file_name = os.path.basename(zip_path)
    media = MediaFileUpload(zip_path, mimetype="application/zip", resumable=True)
    metadata = {"name": file_name, "parents": [folder_id]}
    uploaded = (
        drive_service.files()
        .create(body=metadata, media_body=media, fields="id, webViewLink")
        .execute()
    )
    link = uploaded.get("webViewLink", uploaded["id"])
    print(f"Uploaded to Drive: {link}")
    return link


# ---------------------------------------------------------------------------
# Orchestration (paths changed to /tmp, config from env vars)
# ---------------------------------------------------------------------------

def run_backup(project_id, drive_folder_id):
    if not firebase_admin._apps:
        cred = credentials.ApplicationDefault()
        firebase_admin.initialize_app(cred, {"projectId": project_id})
    db = firestore.client()

    timestamp = datetime.datetime.utcnow().strftime("%Y-%m-%d_%H%M%S")
    backup_dir = os.path.join("/tmp", f"backup_{timestamp}")
    os.makedirs(backup_dir, exist_ok=True)

    print(f"Starting Firestore backup of project '{project_id}'")
    for col_ref in db.collections():
        print(f"Exporting top-level collection: {col_ref.id}")
        export_collection(col_ref, os.path.join(backup_dir, col_ref.id))

    zip_path = shutil.make_archive(backup_dir, "zip", backup_dir)
    shutil.rmtree(backup_dir)
    print(f"Backup zipped: {zip_path}")

    link = None
    if drive_folder_id:
        service = get_drive_service()
        link = upload_to_drive(zip_path, drive_folder_id, service)

    os.remove(zip_path)
    return link


# ---------------------------------------------------------------------------
# Cloud Function entry point
# ---------------------------------------------------------------------------

def backup_handler(request):
    """HTTP Cloud Function entry point.

    Cloud Scheduler sends an HTTP POST here on a weekly schedule.
    Returns 200 on success, 500 on failure.
    """
    project_id = os.environ.get("GCP_PROJECT")
    drive_folder_id = os.environ.get("DRIVE_FOLDER_ID")

    if not project_id:
        return ("GCP_PROJECT environment variable is not set", 500)

    try:
        link = run_backup(project_id, drive_folder_id)
        msg = f"Backup complete. Drive: {link or 'upload skipped'}"
        print(msg)
        return (msg, 200)
    except Exception as exc:
        print(f"Backup failed: {exc}", file=sys.stderr)
        traceback.print_exc()
        return (f"Backup failed: {exc}", 500)
