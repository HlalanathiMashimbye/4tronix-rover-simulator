/**
 * Which Firestore database this deployment reads and writes.
 *
 * Prod and staging share one GCP project. Prod has its own database, `prod`,
 * so that it starts clean: the `(default)` database holds every test mission
 * since the pilot, and it stays with staging. One project rather than a second
 * one, because a second project needs its own billing association, load
 * balancer, certificate, DNS change and operator accounts, and a database needs
 * none of them. Operator roles are custom claims on Firebase Auth users, which
 * belong to the project, so operators carry over by themselves.
 *
 * RUNTIME, NOT BUILD TIME, for the same reason as APP_ENV and APP_URL: prod
 * promotes the exact image built for staging, and a NEXT_PUBLIC_ value is frozen
 * into that image as staging's. The browser reads Firestore directly, so it is
 * told the database by the page itself (FirestoreDatabaseMeta in the root
 * layout), which the server renders from this value on every request.
 */

export const DEFAULT_DATABASE = '(default)';

/** The <meta name> the root layout renders and the browser reads back. */
export const DATABASE_META_NAME = 'firestore-database';

/**
 * Server side: FIREBASE_DATABASE_ID, set per Cloud Run service by Terraform.
 *
 * Prod refuses to run without it rather than falling back. Falling back would
 * put the live site on staging's database, where every page works and every
 * test mission since July is in the feed: nothing would look broken. Staging
 * and local development fall back to `(default)`, which is where their data is,
 * so a service deployed before Terraform set the variable keeps working.
 */
export function resolveFirestoreDatabaseId(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configured = env.FIREBASE_DATABASE_ID?.trim();
  if (configured) {
    return configured;
  }

  const appEnv = env.APP_ENV?.trim().toLowerCase();
  if (appEnv === 'prod' || appEnv === 'production') {
    throw new Error(
      'FIREBASE_DATABASE_ID is not set on prod. Refusing to fall back to the (default) ' +
        "database: that is staging's, and prod would serve its test missions as if they " +
        'were live. Terraform sets it from environments.prod.firestore_database in ' +
        'infra/impact.tfvars; apply that before promoting an image to prod.',
    );
  }

  return DEFAULT_DATABASE;
}

/**
 * Browser side: what the page said. A page without the tag is a page rendered
 * before this existed, by a staging or local server, so `(default)` is right.
 */
export function browserFirestoreDatabaseId(doc: Document = document): string {
  const content = doc
    .querySelector(`meta[name="${DATABASE_META_NAME}"]`)
    ?.getAttribute('content')
    ?.trim();
  return content || DEFAULT_DATABASE;
}
