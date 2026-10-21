/**
 * Which Firestore database a deployment uses, decided at runtime.
 *
 * Prod has its own database in the same project as staging, and runs the image
 * built for staging. So the database is read from the service's environment on
 * the server and from the page in the browser, and prod may not fall back to
 * staging's: a prod on `(default)` serves every test mission since July with
 * nothing on the page looking wrong.
 */

import type { ReactElement } from 'react';

import {
  browserFirestoreDatabaseId,
  DATABASE_META_NAME,
  resolveFirestoreDatabaseId,
} from '@/infrastructure/config/firestoreDatabase';
import { FirestoreDatabaseMeta } from '@/components/layout/FirestoreDatabaseMeta';

const connectionMock = jest.fn(async () => {});
jest.mock('next/server', () => ({ connection: () => connectionMock() }));

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  connectionMock.mockClear();
});

describe('resolveFirestoreDatabaseId', () => {
  it('uses the database the service names', () => {
    expect(resolveFirestoreDatabaseId({ APP_ENV: 'prod', FIREBASE_DATABASE_ID: ' prod ' })).toBe('prod');
  });

  it('refuses to put prod on the (default) database when none is named', () => {
    expect(() => resolveFirestoreDatabaseId({ APP_ENV: 'prod' })).toThrow(/FIREBASE_DATABASE_ID/);
    expect(() => resolveFirestoreDatabaseId({ APP_ENV: 'production', FIREBASE_DATABASE_ID: '  ' })).toThrow();
  });

  it('keeps staging on (default) until Terraform names it, so a deploy before the apply still works', () => {
    expect(resolveFirestoreDatabaseId({ APP_ENV: 'staging' })).toBe('(default)');
  });

  it('uses (default) for local development', () => {
    expect(resolveFirestoreDatabaseId({})).toBe('(default)');
  });
});

describe('browserFirestoreDatabaseId', () => {
  function page(content: string | null): Document {
    return {
      querySelector: (selector: string) =>
        selector === `meta[name="${DATABASE_META_NAME}"]` && content !== null
          ? { getAttribute: (name: string) => (name === 'content' ? content : null) }
          : null,
    } as unknown as Document;
  }

  it('uses the database the page names', () => {
    expect(browserFirestoreDatabaseId(page('prod'))).toBe('prod');
  });

  it('uses (default) on a page that names none', () => {
    expect(browserFirestoreDatabaseId(page(null))).toBe('(default)');
    expect(browserFirestoreDatabaseId(page(''))).toBe('(default)');
  });
});

describe('FirestoreDatabaseMeta', () => {
  function contentOf(element: ReactElement): unknown {
    return (element.props as { name: string; content: unknown }).name === DATABASE_META_NAME
      ? (element.props as { content: unknown }).content
      : undefined;
  }

  it("tells the browser the service's database, read per request", async () => {
    process.env.APP_ENV = 'prod';
    process.env.FIREBASE_DATABASE_ID = 'prod';

    expect(contentOf(await FirestoreDatabaseMeta())).toBe('prod');
    // Without it the tag is rendered once at build time, as staging.
    expect(connectionMock).toHaveBeenCalled();
  });

  it('fails the page on a prod that names no database, rather than serving staging data', async () => {
    process.env.APP_ENV = 'prod';
    delete process.env.FIREBASE_DATABASE_ID;

    await expect(FirestoreDatabaseMeta()).rejects.toThrow(/FIREBASE_DATABASE_ID/);
  });
});
