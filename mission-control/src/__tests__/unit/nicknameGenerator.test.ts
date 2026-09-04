/**
 * Nickname generator tests
 */

import { generateNickname } from '@/core/domain/services/nicknameGenerator';

describe('nicknameGenerator', () => {
  describe('generateNickname', () => {
    it('generates a two-word nickname', () => {
      const nickname = generateNickname();
      const parts = nickname.split(' ');

      expect(parts.length).toBe(2);
      expect(parts[0].length).toBeGreaterThan(0);
      expect(parts[1].length).toBeGreaterThan(0);
    });

    it('generates different nicknames on each call', () => {
      const nicknames = new Set<string>();
      for (let i = 0; i < 100; i++) {
        nicknames.add(generateNickname());
      }

      expect(nicknames.size).toBeGreaterThan(1);
    });

    it('starts with capital letter', () => {
      for (let i = 0; i < 20; i++) {
        const nickname = generateNickname();
        expect(nickname[0]).toMatch(/[A-Z]/);
      }
    });

    it('never exposes raw learner data', () => {
      const nicknames = new Set<string>();
      for (let i = 0; i < 50; i++) {
        nicknames.add(generateNickname());
      }

      // All nicknames should be from the predefined lists
      const adjectives = [
        'Clever', 'Brave', 'Curious', 'Swift', 'Steady', 'Bold', 'Quick',
        'Wise', 'Smart', 'Sharp', 'Keen', 'Nimble', 'Alert', 'Bright', 'Eager',
      ];
      const nouns = [
        'Comet', 'Rover', 'Astronaut', 'Pilot', 'Explorer', 'Navigator',
        'Discoverer', 'Engineer', 'Scientist', 'Satellite', 'Orbiter',
        'Probe', 'Voyager', 'Stargazer', 'Wanderer',
      ];

      nicknames.forEach((nickname) => {
        const [adj, noun] = nickname.split(' ');
        expect(adjectives).toContain(adj);
        expect(nouns).toContain(noun);
      });
    });
  });
});
