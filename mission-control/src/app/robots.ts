import type { MetadataRoute } from 'next';

/**
 * There was no robots.txt at all before this. The learner surface is meant to
 * be found - the discovery feed is public on purpose - so this allows
 * everything except the operator routes.
 *
 * Keeping /operator out of an index is politeness, not protection: a
 * disallowed path is still a published path, and robots.txt is the first place
 * anyone curious looks. lib/auth/dal.ts is what actually stops them.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/operator', '/api/operator'],
    },
  };
}
