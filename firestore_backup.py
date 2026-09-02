"""
firestore_backup.py

Exports an entire Firestore database to local JSON files, mirroring the
Firestore tree (collection -> document -> subcollection -> ...), then
zips the result into a single archive.  Optionally uploads the zip to
a Google Drive folder.

Why JSON files in folders, and not a single SQL-style dump?
Firestore is a document database, not relational -- documents can have
nested maps, arrays, and their own subcollections. A folder tree of JSON
files is the closest local equivalent, and it's readable by a human
(open any _document.json in a text editor) without needing Firestore
tooling to inspect it.

Requires:
    pip install firebase-admin

For Google Drive upload (optional):
    pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib

Usage (with a service account key):
    python firestore_backup.py --project my-gcp-project \
        --cred ./firestore-service-account.json \
        --output-dir ./backups

Usage (with your own Google login instead of a key -- useful if you
can't get a service account granted extra permissions, but your own
account already has read access to the project):
    gcloud auth application-default login
    python firestore_backup.py --project my-gcp-project --output-dir ./backups
    (just omit --cred)

Upload to Google Drive:
    python firestore_backup.py --project my-gcp-project \
        --drive-folder FOLDER_ID \
        --client-secrets ./client_secret.json

On success, prints ONLY the path to the created zip file on stdout
(everything else goes to stderr), so it's easy to capture in a shell
script with: ZIP_PATH=$(python3 firestore_backup.py ...)
"""

import argparse
import datetime
import json
import os
import shutil
import sys

import firebase_admin
from firebase_admin import credentials, firestore

DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"]


def get_drive_service(client_secrets_path, token_path):
    """Build an authorized Google Drive API client.

    On first run, opens a browser for OAuth consent and saves a refresh
    token to *token_path*.  Subsequent runs reuse / refresh that token
    automatically.
    """
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    creds = None
    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, DRIVE_SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                client_secrets_path, DRIVE_SCOPES
            )
            creds = flow.run_local_server(port=0)
        with open(token_path, "w") as f:
            f.write(creds.to_json())

    return build("drive", "v3", credentials=creds)


def upload_to_drive(zip_path, folder_id, drive_service):
    """Upload *zip_path* into the given Google Drive folder."""
    from googleapiclient.http import MediaFileUpload

    file_name = os.path.basename(zip_path)
    media = MediaFileUpload(zip_path, mimetype="application/zip", resumable=True)
    metadata = {"name": file_name, "parents": [folder_id]}

    uploaded = drive_service.files().create(
        body=metadata, media_body=media, fields="id, webViewLink"
    ).execute()

    print(
        f"Uploaded to Drive: {uploaded.get('webViewLink', uploaded['id'])}",
        file=sys.stderr,
    )


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
    """
    Write one document's fields to <out_dir>/<doc_id>/_document.json,
    then recurse into any subcollections it has.
    """
    data = {k: serialize_value(v) for k, v in (doc_snapshot.to_dict() or {}).items()}

    doc_dir = os.path.join(out_dir, doc_snapshot.id)
    os.makedirs(doc_dir, exist_ok=True)
    with open(os.path.join(doc_dir, "_document.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)

    for subcol in doc_ref.collections():
        export_collection(subcol, os.path.join(doc_dir, subcol.id))


def export_collection(col_ref, out_dir):
    """Stream every document in a collection and export it."""
    os.makedirs(out_dir, exist_ok=True)
    docs = list(col_ref.stream())
    print(f"  Collection '{col_ref.id}': {len(docs)} documents", file=sys.stderr)
    for snapshot in docs:
        doc_ref = col_ref.document(snapshot.id)
        export_document(snapshot, doc_ref, out_dir)


def run_backup(project_id, cred_path, output_root,
               drive_folder_id=None, client_secrets_path=None, token_path=None):
    if cred_path:
        # Log in as the service account whose key file was provided.
        cred = credentials.Certificate(cred_path)
    else:
        # No key file given -- fall back to whichever identity is signed
        # in via `gcloud auth application-default login` (i.e. your own
        # Google account). Useful when you can't get extra permissions
        # granted to a service account, but your own login already has
        # read access to this project.
        print(
            "No --cred given; using your own 'gcloud auth application-default' login.",
            file=sys.stderr,
        )
        cred = credentials.ApplicationDefault()

    # initialize_app raises if called twice in one process; guard for
    # re-use (e.g. if this is imported rather than run standalone).
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred, {"projectId": project_id})
    db = firestore.client()

    timestamp = datetime.datetime.utcnow().strftime("%Y-%m-%d_%H%M%S")
    backup_dir = os.path.join(output_root, f"backup_{timestamp}")
    os.makedirs(backup_dir, exist_ok=True)

    print(f"Starting Firestore backup of project '{project_id}' -> {backup_dir}", file=sys.stderr)
    for col_ref in db.collections():
        print(f"Exporting top-level collection: {col_ref.id}", file=sys.stderr)
        export_collection(col_ref, os.path.join(backup_dir, col_ref.id))

    zip_path = shutil.make_archive(backup_dir, "zip", backup_dir)
    # Remove the uncompressed copy so we don't keep two copies of every backup locally.
    shutil.rmtree(backup_dir)
    print(f"Backup complete: {zip_path}", file=sys.stderr)

    if drive_folder_id:
        try:
            service = get_drive_service(client_secrets_path, token_path)
            upload_to_drive(zip_path, drive_folder_id, service)
        except Exception as exc:
            print(f"WARNING: Drive upload failed: {exc}", file=sys.stderr)
            print("The local backup is still safe.", file=sys.stderr)

    # Only this line goes to stdout -- lets shell scripts capture the path cleanly.
    print(zip_path)
    return zip_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export Firestore to local JSON, zipped.")
    parser.add_argument("--project", required=True, help="GCP project ID")
    parser.add_argument(
        "--cred",
        required=False,
        default=None,
        help="Path to service account JSON key. Omit to use your own login "
        "via 'gcloud auth application-default login' instead.",
    )
    parser.add_argument("--output-dir", default="./backups", help="Where to write backups")
    parser.add_argument(
        "--drive-folder",
        default=None,
        help="Google Drive folder ID to upload the zip to. "
        "Omit to skip Drive upload.",
    )
    parser.add_argument(
        "--client-secrets",
        default="./client_secret.json",
        help="Path to OAuth client secrets JSON (default: ./client_secret.json)",
    )
    parser.add_argument(
        "--token-path",
        default="./token.json",
        help="Path to store/read the OAuth refresh token (default: ./token.json)",
    )
    args = parser.parse_args()

    run_backup(
        args.project,
        args.cred,
        args.output_dir,
        drive_folder_id=args.drive_folder,
        client_secrets_path=args.client_secrets,
        token_path=args.token_path,
    )
