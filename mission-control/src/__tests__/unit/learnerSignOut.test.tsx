/**
 * @jest-environment jsdom
 */

/**
 * Signing a learner out on a shared classroom machine. Nothing of theirs may
 * be left for the next child: not the id, not the email the next prompt would
 * show, not the mission that email would be stamped onto, and not the pages
 * still on screen. When the button is offered is in ProfileSignOut.test.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  getDoc: jest.fn(async () => ({ exists: () => false })),
  setDoc: jest.fn(async () => {}),
  updateDoc: jest.fn(async () => {}),
  serverTimestamp: jest.fn(),
}));
jest.mock('@/infrastructure/persistence/firebase-client', () => ({ getFirestoreClient: jest.fn() }));
jest.mock('@/core/domain/services/learnerRef', () => ({ hashLearnerId: jest.fn(async () => 'ref') }));

import { LearnerProvider, useLearner } from '@/contexts/LearnerContext';

function SignOutButton() {
  const { signOut } = useLearner();
  return <button onClick={signOut}>Sign out</button>;
}

async function signOutOf(storage: Record<string, string>) {
  for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
  render(
    <LearnerProvider>
      <SignOutButton />
    </LearnerProvider>,
  );
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
}

let errors: jest.SpyInstance;

beforeEach(() => {
  localStorage.clear();
  errors = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => errors.mockRestore());

it('forgets the learner, their email and their latest mission on this device', async () => {
  await signOutOf({
    'mars-rover-learner-id': 'learner-a',
    'rover-profile-saved': 'true',
    learnerEmail: 'a@example.com',
    'rover-latest-mission-id': 'mission-a',
  });

  expect(localStorage.getItem('mars-rover-learner-id')).toBeNull();
  expect(localStorage.getItem('rover-profile-saved')).toBeNull();
  expect(localStorage.getItem('learnerEmail')).toBeNull();
  expect(localStorage.getItem('rover-latest-mission-id')).toBeNull();
});

it('reloads the page, so nothing still on screen belongs to the last learner', async () => {
  // jsdom cannot navigate and will not let location.assign be replaced; it
  // reports the attempt instead, which is what this listens for. It stays
  // silent for a jump to the page already open, hence signing out from
  // History.
  window.history.pushState({}, '', '/history');

  await signOutOf({ 'mars-rover-learner-id': 'learner-a', 'rover-profile-saved': 'true' });

  const reported = errors.mock.calls.flat().map((arg) => String((arg as Error)?.message ?? arg));
  expect(reported.some((message) => /not implemented: navigation/i.test(message))).toBe(true);
});
