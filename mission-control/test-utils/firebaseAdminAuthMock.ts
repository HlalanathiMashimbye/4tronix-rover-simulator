/**
 * CommonJS-compatible firebase-admin/auth mock for Jest.
 *
 * firebase-admin@14 pulls in jwks-rsa, which requires `jose` - pure ESM that
 * ts-jest (node env) cannot transform from node_modules. Nothing under test
 * calls getFirebaseAdminAuth()'s real behavior (session-cookie verification
 * needs live Firebase credentials); tests that touch auth mock the whole
 * @/infrastructure/persistence/firebase-admin wrapper instead. This stand-in
 * only needs to satisfy the module shape so the top-level import in that
 * wrapper doesn't drag in jose at all.
 */
export const getAuth = () => ({});
export type Auth = ReturnType<typeof getAuth>;
