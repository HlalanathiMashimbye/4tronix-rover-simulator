"""
The satellite's local mirror of Firestore, split by concern.

The console and the sync worker both go through `mission_store`, which is a
facade over this package. Nothing here imports that facade: the dependency
graph is a DAG (db <- outbox <- missions/runs/review, and db <- meta) and
importing the facade from inside would make a cycle out of it.

A test redirecting the mirror at a temporary file must patch
`store.db.DB_PATH`, which is where `_connect()` reads it.
"""
