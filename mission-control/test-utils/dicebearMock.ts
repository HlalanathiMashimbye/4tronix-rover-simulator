/**
 * CommonJS-compatible DiceBear mock for Jest, standing in for @dicebear/core
 * and the style packages alike.
 *
 * DiceBear v9 ships as pure ESM, which ts-jest (node env) cannot transform
 * from node_modules. Every page with the navbar renders the learner's avatar,
 * so without this any test of such a page fails to load at all. Tests only
 * need an image source, not the drawing; the seed is kept in it so two
 * avatars are still told apart.
 */
export const createAvatar = (_style: unknown, options: { seed?: string } = {}) => ({
  toDataUri: () => `data:image/svg+xml;utf8,<svg data-seed="${options.seed ?? ''}"/>`,
});
