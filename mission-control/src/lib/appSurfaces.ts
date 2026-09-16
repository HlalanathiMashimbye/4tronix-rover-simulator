/**
 * Which surface of the app a path belongs to.
 *
 * One function so far, and the file is named for the question rather than the
 * answer on purpose: an import of `@/lib/operatorSurface` would itself put the
 * substring "/operator" into whichever file imported it, which is exactly what
 * the check below refuses to allow in the navbar.
 */

/**
 * Whether a path belongs to the operator surface.
 *
 * The navbar has to know: it drops the learner's floating Create Mission
 * button there, where it is a control nobody signed in as an operator can use
 * and it sits fixed over the bottom-right corner of a console that uses every
 * pixel. What the navbar must NOT do is name the route. AB#341 keeps the
 * operator path out of the learner navigation, and
 * `__tests__/unit/operator-route-hidden.test.ts` enforces it by reading
 * Navbar.tsx and failing on the string. That is a blunt check and the right
 * one - a link added in a hurry and a path compared in a hurry look identical
 * in a diff, and only one of them is safe - so the string lives here instead.
 *
 * proxy.ts states the same prefix again in its matcher, because Next requires
 * that to be a literal it can read at build time.
 */
const OPERATOR_PREFIX = '/operator';

export function isOperatorSurface(pathname: string): boolean {
  // Not a bare startsWith: that also claims a future /operators-guide, and a
  // learner page silently losing its Create Mission button is the kind of
  // thing nobody reports.
  return pathname === OPERATOR_PREFIX || pathname.startsWith(`${OPERATOR_PREFIX}/`);
}
