/**
 * The rate limit in front of a public route, at the HTTP layer.
 *
 * FirestoreRateLimiter.test.ts covers the counting; this covers what a route
 * does with the answer: when the limiter says no, the route must return 429 and
 * do none of its work, and the key it checks must carry the caller's real IP.
 * POST /api/missions stands in for all three limited routes, which share one
 * helper (app/api/rateLimit.ts).
 */

const allow = jest.fn();
const submitMission = jest.fn();
const notifyStatusChange = jest.fn();

jest.mock('@/infrastructure/container.server', () => ({
  rateLimiter: () => ({ allow }),
  missionService: () => ({ submitMission }),
  notificationService: () => ({ notifyStatusChange }),
}));

import { POST } from '@/app/api/missions/route';
import { NextRequest } from 'next/server';

const VALID_MISSION = {
  yardId: 'curiosity',
  sessionId: 'test-session-123',
  learnerId: 'test-learner',
  name: 'Red Explorer',
  code: 'rover.forward(100)\nrover.wait(2)',
};

function submit(headers: Record<string, string> = {}) {
  return POST(new NextRequest('http://localhost:3000/api/missions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(VALID_MISSION),
  }));
}

describe('a public route under its rate limit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    submitMission.mockResolvedValue({ success: true, mission: { id: 'm1', name: 'Red Explorer' } });
    notifyStatusChange.mockResolvedValue({ sent: true });
  });

  it('returns 429 and does no work when the limiter says no', async () => {
    allow.mockResolvedValue(false);

    const response = await submit();

    expect(response.status).toBe(429);
    expect(submitMission).not.toHaveBeenCalled();
    expect(notifyStatusChange).not.toHaveBeenCalled();
  });

  it('submits as normal when the limiter allows it', async () => {
    allow.mockResolvedValue(true);

    const response = await submit();

    expect(response.status).toBe(201);
    expect(submitMission).toHaveBeenCalled();
  });

  it('keys the limit by the forwarded client IP, not the proxy chain', async () => {
    allow.mockResolvedValue(false);

    await submit({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' });

    expect(allow).toHaveBeenCalledWith('missions:203.0.113.9', expect.any(Number), expect.any(Number));
  });

  it('prefers the Cloudflare client IP header', async () => {
    allow.mockResolvedValue(false);

    await submit({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '203.0.113.9' });

    expect(allow).toHaveBeenCalledWith('missions:198.51.100.7', expect.any(Number), expect.any(Number));
  });
});
