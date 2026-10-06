'use client';

import { useEffect, useState } from 'react';

import type { YardLayout } from '@/core/domain/entities/Yard';
import { DEFAULT_YARD_ID } from '@/infrastructure/config/yard';
import { YARD } from '@/lib/rover-physics';

/**
 * The layout a yard's simulator draws and drives in (AB#468), and the yard's
 * current id, which is the one its floor photo is filed under.
 *
 * The measured yard AT ONCE, then the configured one when it arrives. Nothing
 * waits for the request: until it answers the simulator is the measured yard,
 * which is what an unconfigured yard is anyway (layoutOf), so the only thing a
 * slow network costs is a yard edited in the last few minutes showing its
 * previous rocks for a moment.
 *
 * One request per yard for the page, shared by every simulator and cover that
 * asks, and every one of them gets the same object back, so a component that
 * simulates a run and the one that draws it cannot disagree about the yard.
 */
export interface YardLayoutAnswer {
  yardId: string;
  layout: YardLayout;
}

const answers = new Map<string, YardLayoutAnswer>();
const requests = new Map<string, Promise<YardLayoutAnswer>>();

function fetchLayout(yardId: string): Promise<YardLayoutAnswer> {
  let request = requests.get(yardId);
  if (!request) {
    // No fetch (a test's jsdom, a very old browser): the measured yard it is.
    if (typeof fetch !== 'function') return Promise.reject(new Error('fetch is unavailable'));
    request = fetch(`/api/yards/${encodeURIComponent(yardId)}/layout`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((body: { yardId?: string; layout?: YardLayout }) => {
        const answer = { yardId: body.yardId || yardId, layout: body.layout ?? YARD };
        answers.set(yardId, answer);
        return answer;
      })
      .catch((error) => {
        // Forgotten, so the next simulator to mount asks again.
        requests.delete(yardId);
        throw error;
      });
    requests.set(yardId, request);
  }
  return request;
}

export function useYardLayout(yardId: string | undefined): YardLayoutAnswer {
  const id = yardId?.trim() || DEFAULT_YARD_ID;
  const [, settled] = useState(0);

  useEffect(() => {
    if (answers.has(id)) return;
    let mounted = true;
    fetchLayout(id).then(
      () => {
        if (mounted) settled((n) => n + 1);
      },
      () => {},
    );
    return () => {
      mounted = false;
    };
  }, [id]);

  return answers.get(id) ?? { yardId: id, layout: YARD };
}

/** Test seam: forget every answer, as a fresh page would. */
export function forgetYardLayouts(): void {
  answers.clear();
  requests.clear();
}
