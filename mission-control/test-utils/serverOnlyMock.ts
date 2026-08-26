// Stands in for the `server-only` package under jest.
//
// The real package throws when imported outside a React Server Component, which
// is exactly what makes it useful: it stops a module holding admin credentials
// from being pulled into a client bundle. Under test there is no such boundary,
// so it maps to nothing.
export {};
