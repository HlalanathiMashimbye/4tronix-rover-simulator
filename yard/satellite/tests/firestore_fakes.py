"""
One set of Firestore test doubles for the whole satellite suite.

WHY THIS FILE EXISTS. test_operator_console.py and test_sync_worker.py each
grew their own reimplementation of the same Firestore surface, and
test_sync_worker.py then grew a *second* one for run subcollections. Twenty-two
Fake* classes, most of them the same class twice under different names
(FakeSnapshot/FakeSnap are byte-identical bodies), each drifting where its own
tests happened to need something: one query fake supports only `==`, the other
supports `>` and FieldFilter; one doc ref counts reads, the other can write.

That duplication is the clearest evidence for the satellite's real structural
problem, which is that it declares no abstractions at all. There was no
interface for a fake to implement, so each test file invented its own idea of
what Firestore looks like, and none of them could be checked against anything.
`ports.py` now states that shape once; this file is the one implementation of
it that tests share.

The behaviour here is the union of what the old fakes did, taking the more
capable version wherever they disagreed:

  queries      real filtering (`==` and `>`), real ordering and real slicing,
               accepting both `where(field, op, value)` and the modern
               `where(filter=FieldFilter(...))`
  reads        metered, because sync_worker tests assert the Firestore quota
               cost of a cycle, not just its behaviour
  writes       `update` merges, `set` replaces unless merge=True
  structure    nested subcollections, so missions/{id}/runs/{yardId} works
"""


class FakeSnapshot:
    """A document read. `exists` is False for a document that is not there."""

    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data else None


class FakeStreamDoc:
    """A document as returned by a query, which carries its id."""

    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data

    def to_dict(self):
        return dict(self._data)


class FakeDocRef:
    """A reference to one document, addressed by its full path key.

    Documents live in a flat dict keyed by path ('m1' at the top level,
    'm1/curiosity' for a run underneath it), which is enough structure for
    everything the satellite does and far less machinery than modelling real
    nesting.
    """

    def __init__(self, store, doc_id, meter=None):
        self._store = store
        self._id = doc_id
        self._meter = meter

    def get(self, transaction=None):
        # Reads inside a transaction are not billed separately here; the
        # sync_worker quota tests count plain reads.
        if self._meter is not None and transaction is None:
            self._meter['docs_read'] += 1
        return FakeSnapshot(self._store.get(self._id))

    def update(self, fields):
        self._store.setdefault(self._id, {}).update(fields)

    def set(self, fields, merge=False):
        if merge:
            self._store.setdefault(self._id, {}).update(fields)
        else:
            self._store[self._id] = dict(fields)

    def collection(self, name):
        """A subcollection of this document, e.g. missions/{id}/runs."""
        return FakeCollection(self._store, self._meter, prefix=self._id)


class FakeTransaction:
    """Applies writes immediately.

    The fake has no rollback, which is fine: these tests exercise decision
    logic, not Firestore's atomicity.
    """

    def __init__(self, store=None):
        self._store = store

    def update(self, ref, fields):
        ref.update(fields)

    def set(self, ref, fields, merge=False):
        ref.set(fields, merge=merge)


class FakeQuery:
    """The where/order_by/limit/stream chain, counting documents read.

    Read counting is the point for sync_worker: the naive worker pulled 200
    docs every 30s, which is 576,000 reads/day against a 50,000/day quota.
    Those tests assert the cost, not just the behaviour.
    """

    def __init__(self, store, meter=None, rows=None, prefix=''):
        self._store = store
        self._meter = meter if meter is not None else {'queries': 0, 'docs_read': 0}
        self._prefix = prefix
        self._rows = self._own_rows() if rows is None else rows

    def _own_rows(self):
        """Documents belonging to this collection level.

        Top level takes keys with no '/', a subcollection takes keys directly
        under its prefix, so a mission's runs do not show up in a scan of
        missions.
        """
        if self._prefix:
            head = self._prefix + '/'
            return [(k, v) for k, v in self._store.items()
                    if k.startswith(head) and '/' not in k[len(head):]]
        return [(k, v) for k, v in self._store.items() if '/' not in k]

    def _derive(self, rows):
        return FakeQuery(self._store, self._meter, rows, self._prefix)

    def where(self, field=None, op=None, value=None, filter=None):
        """Accepts both the positional form and the modern keyword FieldFilter.

        google-cloud-firestore deprecated `where(field, op, value)`; production
        code has moved to `where(filter=FieldFilter(...))`, and both shapes are
        supported so this fake does not dictate which the caller uses.
        """
        if filter is not None:
            field = filter.field_path
            op = filter.op_string
            value = filter.value

        def keep(item):
            v = item[1].get(field)
            if op == '==':
                return v == value
            if op == '>':
                return v is not None and v > value
            raise AssertionError(f'fake does not support operator {op}')

        return self._derive([i for i in self._rows if keep(i)])

    def order_by(self, field, direction=None):
        rows = sorted(self._rows, key=lambda i: i[1].get(field) or '',
                      reverse=(direction == 'DESCENDING'))
        return self._derive(rows)

    def limit(self, n):
        return self._derive(self._rows[:n])

    def stream(self):
        self._meter['queries'] += 1
        # Firestore bills a minimum of one read even for an empty result.
        self._meter['docs_read'] += max(1, len(self._rows))
        return [FakeStreamDoc(self._leaf(k), v) for k, v in self._rows]

    def _leaf(self, key):
        """Document id without its parent path, which is what Firestore returns."""
        return key.rsplit('/', 1)[-1] if self._prefix else key


class FakeCollection(FakeQuery):
    """A queryable collection that can also address documents by id."""

    def document(self, doc_id):
        key = f'{self._prefix}/{doc_id}' if self._prefix else doc_id
        return FakeDocRef(self._store, key, self._meter)


class FakeFirestore:
    """Entry point. `meter` records reads so a test can assert quota cost."""

    def __init__(self, store):
        self._store = store
        self.meter = {'queries': 0, 'docs_read': 0}

    @property
    def pulls(self):
        return self.meter['queries']

    def collection(self, name):
        return FakeCollection(self._store, self.meter)

    def transaction(self):
        return FakeTransaction(self._store)
