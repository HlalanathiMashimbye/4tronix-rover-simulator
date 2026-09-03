"""
The interfaces the satellite depends on.

The satellite declared no abstractions at all: no ABC, no Protocol, nothing
that said what a collaborator has to look like. The rover has had them for a
while (RoverDriver, Telemetry, RoverQueuePort in yard/rover), and the
difference showed. With nothing to implement, two test files independently
invented their own idea of what Firestore looks like, drifted apart, and
neither could be checked against anything.

These are typing.Protocol, not ABC, deliberately. The real collaborator is
google.cloud.firestore's client, which we do not control and cannot subclass;
a Protocol describes the shape we rely on without requiring anyone to inherit
from it, so both the real client and tests/firestore_fakes.py satisfy it by
structure alone.

Deliberately minimal: only the methods satellite code actually calls. This is
documentation of a real dependency, not an attempt to model Firestore.
"""

from typing import Any, Iterable, Optional, Protocol


class DocumentSnapshot(Protocol):
    """One document as returned by a read."""

    exists: bool

    def to_dict(self) -> Optional[dict]:
        ...


class StreamedDocument(Protocol):
    """One document as returned by a query, which carries its id."""

    id: str

    def to_dict(self) -> dict:
        ...


class DocumentReference(Protocol):
    """A pointer to one document, whether or not it exists."""

    def get(self, transaction: Optional[Any] = None) -> DocumentSnapshot:
        ...

    def update(self, fields: dict) -> Any:
        ...

    def set(self, fields: dict, merge: bool = False) -> Any:
        ...

    def collection(self, name: str) -> 'CollectionReference':
        ...


class Query(Protocol):
    """The chainable half of a collection.

    `where` is the keyword form: google-cloud-firestore deprecated positional
    `where(field, op, value)` in favour of `where(filter=FieldFilter(...))`,
    and the satellite has moved over.
    """

    def where(self, filter: Any = None) -> 'Query':
        ...

    def order_by(self, field: str, direction: Optional[str] = None) -> 'Query':
        ...

    def limit(self, count: int) -> 'Query':
        ...

    def stream(self) -> Iterable[StreamedDocument]:
        ...


class CollectionReference(Query, Protocol):
    """A collection: queryable, and able to address documents by id."""

    def document(self, doc_id: str) -> DocumentReference:
        ...


class Transaction(Protocol):
    """A batch of writes applied together."""

    def update(self, ref: DocumentReference, fields: dict) -> Any:
        ...

    def set(self, ref: DocumentReference, fields: dict, merge: bool = False) -> Any:
        ...


class FirestoreClient(Protocol):
    """What sync_worker and the operator console need from Firestore."""

    def collection(self, name: str) -> CollectionReference:
        ...

    def transaction(self) -> Transaction:
        ...
