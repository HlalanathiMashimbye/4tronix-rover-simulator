"""
firestore_restore.py

Restores a Firestore backup (created by firestore_backup.py) from a local
zip file back into a live Firestore database.

THIS OVERWRITES LIVE DATA. Only run this during a real incident, with
confirmation from your team.

The backup zip structure mirrors Firestore:
    collection/
        doc_id/
            _document.json          <- the document's fields
            subcollection_name/     <- subcollections are child folders
                sub_doc_id/
                    _document.json

How to use:
    1. Download the backup zip from Google Drive (just click download in
       the browser -- no API or credentials needed for this step).

    2. Run the restore, authenticating with your own Google account:

           gcloud auth application-default login
           python firestore_restore.py --project my-gcp-project \\
               --zip ./backup_2026-09-07_030000.zip

       Or with a service account key:

           python firestore_restore.py --project my-gcp-project \\
               --cred ./service-account-key.json \\
               --zip ./backup_2026-09-07_030000.zip

    3. Always do a dry run first to preview what will be written:

           python firestore_restore.py --project my-gcp-project \\
               --zip ./backup_2026-09-07_030000.zip \\
               --dry-run

Requires:
    pip install firebase-admin
"""

import argparse
import json
import os
import shutil
import sys
import tempfile
import zipfile

import firebase_admin
from firebase_admin import credentials, firestore


def restore_collection(db, col_dir, collection_path, dry_run=False):
    """Restore all documents in a collection directory."""
    count = 0
    for doc_id in sorted(os.listdir(col_dir)):
        doc_dir_path = os.path.join(col_dir, doc_id)
        if not os.path.isdir(doc_dir_path):
            continue

        doc_file = os.path.join(doc_dir_path, "_document.json")
        if os.path.exists(doc_file):
            with open(doc_file, "r", encoding="utf-8") as f:
                doc_data = json.load(f)

            doc_ref = db.collection(collection_path).document(doc_id)
            if dry_run:
                print(f"  [DRY RUN] Would write: {collection_path}/{doc_id}")
            else:
                doc_ref.set(doc_data)
                print(f"  Restored: {collection_path}/{doc_id}")
            count += 1

        for entry in sorted(os.listdir(doc_dir_path)):
            entry_path = os.path.join(doc_dir_path, entry)
            if os.path.isdir(entry_path):
                subcol_path = f"{collection_path}/{doc_id}/{entry}"
                count += restore_collection(db, entry_path, subcol_path, dry_run)

    return count


def run_restore(db, backup_root, dry_run=False):
    """Walk the backup root and restore all collections."""
    total = 0
    for col_name in sorted(os.listdir(backup_root)):
        col_path = os.path.join(backup_root, col_name)
        if not os.path.isdir(col_path):
            continue
        print(f"Restoring collection: {col_name}")
        total += restore_collection(db, col_path, col_name, dry_run)
    return total


def main():
    parser = argparse.ArgumentParser(
        description="Restore a Firestore backup from a zip file. OVERWRITES LIVE DATA.",
    )
    parser.add_argument("--project", required=True, help="GCP project ID")
    parser.add_argument("--zip", required=True, help="Path to the backup zip file")
    parser.add_argument(
        "--cred",
        default=None,
        help="Path to service account JSON key. Omit to use "
        "'gcloud auth application-default login'.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview what would be restored without writing anything.",
    )
    args = parser.parse_args()

    if not os.path.exists(args.zip):
        print(f"Error: zip file not found: {args.zip}", file=sys.stderr)
        sys.exit(1)

    print("=" * 60)
    print("  FIRESTORE RESTORE")
    print("=" * 60)
    print(f"  Project:  {args.project}")
    print(f"  Source:   {args.zip}")
    print(f"  Mode:     {'DRY RUN (no writes)' if args.dry_run else 'LIVE — WILL OVERWRITE DATA'}")
    print("=" * 60)

    if not args.dry_run:
        print()
        print("  WARNING: This will overwrite documents in your LIVE Firestore")
        print("  database. Any document in the backup will replace the current")
        print("  version in Firestore. Documents not in the backup are NOT deleted.")
        print()
        confirm = input("  Type the project ID to confirm: ").strip()
        if confirm != args.project:
            print("Confirmation did not match. Aborting.", file=sys.stderr)
            sys.exit(1)
        print()

    if args.cred:
        cred = credentials.Certificate(args.cred)
    else:
        print("Using 'gcloud auth application-default login' credentials.")
        cred = credentials.ApplicationDefault()

    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred, {"projectId": args.project})
    db = firestore.client()

    tmp_dir = tempfile.mkdtemp()
    try:
        print(f"Extracting {args.zip} ...")
        with zipfile.ZipFile(args.zip, "r") as zf:
            zf.extractall(tmp_dir)

        extracted = os.listdir(tmp_dir)
        if len(extracted) == 1 and os.path.isdir(os.path.join(tmp_dir, extracted[0])):
            backup_root = os.path.join(tmp_dir, extracted[0])
        else:
            backup_root = tmp_dir

        print(f"Restoring to Firestore project '{args.project}' ...")
        print()
        count = run_restore(db, backup_root, dry_run=args.dry_run)

        print()
        if args.dry_run:
            print(f"Dry run complete. {count} document(s) would be restored.")
            print("Run again without --dry-run to actually restore.")
        else:
            print(f"Restore complete. {count} document(s) written to Firestore.")
    finally:
        shutil.rmtree(tmp_dir)


if __name__ == "__main__":
    main()
