/**
 * @jest-environment jsdom
 */

/**
 * Operators can sign in with Google as well as a password.
 *
 * Everything after Firebase says who someone is goes through the same server
 * exchange, so these tests drive the browser half: the button, the yard it
 * needs, the one retry a first sign-in needs, and the errors a person can act
 * on. The server's half is in auth.session.api.test.ts.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const signInWithPopup = jest.fn();
const setCustomParameters = jest.fn();
const signOut = jest.fn();

jest.mock('firebase/auth', () => ({
  GoogleAuthProvider: jest.fn().mockImplementation(() => ({ setCustomParameters })),
  signInWithPopup: (...a: unknown[]) => signInWithPopup(...a),
  signInWithEmailAndPassword: jest.fn(),
}));

jest.mock('@/infrastructure/persistence/firebase-client', () => ({
  getFirebaseAuth: () => ({ signOut }),
}));

import { OperatorSignIn } from '@/components/operator/OperatorSignIn';

const YARDS = [
  { id: 'curiosity', name: 'Cape Town Science Centre', area: 'Observatory', city: 'Cape Town', active: true },
  { id: 'spirit', name: 'Sci-Bono', area: 'Newtown', city: 'Johannesburg', active: true },
];

const googleButton = () => screen.getByRole('button', { name: /continue with google/i });

/** A user from the popup, whose token changes each time it is asked for. */
function popupUser() {
  let n = 0;
  const getIdToken = jest.fn(async () => `token-${++n}`);
  signInWithPopup.mockResolvedValue({ user: { getIdToken } });
  return getIdToken;
}

function answers(...responses: Array<{ status: number; body: unknown }>) {
  const fetchMock = jest.fn();
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce({ ok: r.status < 300, status: r.status, json: async () => r.body });
  }
  global.fetch = fetchMock;
  return fetchMock;
}

beforeEach(() => {
  jest.clearAllMocks();
  signOut.mockResolvedValue(undefined);
  // jsdom cannot navigate; the hard navigation after sign-in only logs that.
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

function chooseYard(id = 'curiosity') {
  fireEvent.change(screen.getByRole('combobox'), { target: { value: id } });
}

it('has a Google button with the Google mark', () => {
  render(<OperatorSignIn yards={YARDS} />);

  expect(googleButton()).toBeInTheDocument();
  expect(googleButton().querySelector('svg')).not.toBeNull();
});

it('waits for the yard, because the session is for a yard whichever way you sign in', () => {
  render(<OperatorSignIn yards={YARDS} />);
  expect(googleButton()).toBeDisabled();

  chooseYard();
  expect(googleButton()).toBeEnabled();
});

it('always offers the account chooser, so a shared laptop does not sign in whoever is already signed in to Google', async () => {
  popupUser();
  answers({ status: 200, body: { success: true } });
  render(<OperatorSignIn yards={YARDS} />);
  chooseYard();

  await act(async () => fireEvent.click(googleButton()));

  expect(setCustomParameters).toHaveBeenCalledWith({ prompt: 'select_account' });
});

it('exchanges the Google sign-in for a session at the chosen yard', async () => {
  popupUser();
  const fetchMock = answers({ status: 200, body: { success: true } });
  render(<OperatorSignIn yards={YARDS} />);
  chooseYard('spirit');

  await act(async () => fireEvent.click(googleButton()));

  await waitFor(() => expect(signOut).toHaveBeenCalled());
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: 'token-1', yardId: 'spirit' });
});

it('comes back once with a fresh token when the server has just applied an invite', async () => {
  // The first token predates the role the server wrote moments ago.
  const getIdToken = popupUser();
  const fetchMock = answers(
    { status: 409, body: { success: false, refresh: true } },
    { status: 200, body: { success: true } },
  );
  render(<OperatorSignIn yards={YARDS} />);
  chooseYard();

  await act(async () => fireEvent.click(googleButton()));

  await waitFor(() => expect(signOut).toHaveBeenCalled());
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(getIdToken).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).token).toBe('token-2');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('shows the server\'s reason when the account has no access', async () => {
  popupUser();
  answers({ status: 403, body: { success: false, error: 'This account (x@y.org) does not have operator access yet.' } });
  render(<OperatorSignIn yards={YARDS} />);
  chooseYard();

  await act(async () => fireEvent.click(googleButton()));

  expect(await screen.findByRole('alert')).toHaveTextContent('x@y.org');
  expect(signOut).not.toHaveBeenCalled();
});

it('treats closing the Google window as changing your mind, not an error', async () => {
  signInWithPopup.mockRejectedValue({ code: 'auth/popup-closed-by-user' });
  render(<OperatorSignIn yards={YARDS} />);
  chooseYard();

  await act(async () => fireEvent.click(googleButton()));

  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(googleButton()).toBeEnabled();
});

it('points a password account back to the password fields', async () => {
  // One account per email: this address already signs in with a password.
  signInWithPopup.mockRejectedValue({ code: 'auth/account-exists-with-different-credential' });
  render(<OperatorSignIn yards={YARDS} />);
  chooseYard();

  await act(async () => fireEvent.click(googleButton()));

  expect(await screen.findByRole('alert')).toHaveTextContent(/email and password/i);
});

it('says how to fix a blocked pop-up', async () => {
  signInWithPopup.mockRejectedValue({ code: 'auth/popup-blocked' });
  render(<OperatorSignIn yards={YARDS} />);
  chooseYard();

  await act(async () => fireEvent.click(googleButton()));

  expect(await screen.findByRole('alert')).toHaveTextContent(/pop-ups/i);
});

describe('asking an admin when the account has no access', () => {
  const noAccess = { status: 403, body: { success: false, code: 'no-access', email: 'thandi@school.org', error: 'No access' } };

  it('opens a pop-up offering to ask an admin, naming the account', async () => {
    popupUser();
    answers(noAccess);
    render(<OperatorSignIn yards={YARDS} />);
    chooseYard();

    await act(async () => fireEvent.click(googleButton()));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('thandi@school.org');
    expect(screen.getByRole('button', { name: 'Ask an admin' })).toBeInTheDocument();
  });

  it('sends the request with the verified sign-in, then says it was sent', async () => {
    popupUser();
    const fetchMock = answers(noAccess, { status: 200, body: { success: true, notified: 1 } });
    render(<OperatorSignIn yards={YARDS} />);
    chooseYard();
    await act(async () => fireEvent.click(googleButton()));

    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Ask an admin' })));

    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/access-request');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toHaveProperty('token');
    expect(await screen.findByText('Request sent')).toBeInTheDocument();
  });

  it('shows why when the request could not be sent', async () => {
    popupUser();
    answers(noAccess, { status: 502, body: { success: false, error: 'Could not email an admin.' } });
    render(<OperatorSignIn yards={YARDS} />);
    chooseYard();
    await act(async () => fireEvent.click(googleButton()));

    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Ask an admin' })));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not email an admin.');
  });

  it('signs the Google account out when the pop-up is dismissed', async () => {
    popupUser();
    answers(noAccess);
    render(<OperatorSignIn yards={YARDS} />);
    chooseYard();
    await act(async () => fireEvent.click(googleButton()));

    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));

    expect(signOut).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
