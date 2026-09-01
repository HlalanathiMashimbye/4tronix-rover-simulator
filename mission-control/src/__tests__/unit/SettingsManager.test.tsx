/**
 * @jest-environment jsdom
 */

/**
 * The admin settings UI. The page itself is a server component behind an
 * admin redirect, so this renders the part that actually has behaviour.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SettingsManager } from '@/components/operator/SettingsManager';
import type { SettingStatus } from '@/core/domain/services/runtimeSettings';

function setting(over: Partial<SettingStatus> = {}): SettingStatus {
  return {
    name: 'youtubeChannelId',
    group: 'youtube',
    label: 'YouTube channel',
    help: 'The channel run videos are uploaded to.',
    secret: false,
    configured: true,
    value: 'UCoriginal',
    ...over,
  };
}

beforeEach(() => {
  global.fetch = jest.fn(async (_url, init) => {
    const body = JSON.parse(String((init as RequestInit).body));
    return {
      ok: true,
      json: async () => ({ success: true, setting: setting({ ...body, configured: true }) }),
    };
  }) as unknown as typeof fetch;
});

afterEach(() => jest.resetAllMocks());

describe('settings rows', () => {
  it('shows a non-secret value so an admin can see what it is', () => {
    render(<SettingsManager initialSettings={[setting()]} />);

    expect(screen.getByLabelText('YouTube channel')).toHaveValue('UCoriginal');
  });

  it('never renders a secret value, and masks the field', () => {
    render(
      <SettingsManager
        initialSettings={[
          setting({ name: 'resendApiKey', label: 'Resend API key', secret: true, value: null }),
        ]}
      />,
    );

    const field = screen.getByLabelText('Resend API key');
    expect(field).toHaveValue('');
    expect(field).toHaveAttribute('type', 'password');
  });

  it('says whether each setting is set', () => {
    render(
      <SettingsManager
        initialSettings={[setting({ configured: false, value: null })]}
      />,
    );

    expect(screen.getByText('Not set')).toBeInTheDocument();
  });

  it('saves one setting without touching the others', async () => {
    render(
      <SettingsManager
        initialSettings={[
          setting(),
          setting({ name: 'resendFromEmail', label: 'Send mail from', value: 'a@b.co' }),
        ]}
      />,
    );

    fireEvent.change(screen.getByLabelText('YouTube channel'), { target: { value: 'UCnew' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String((jest.mocked(global.fetch).mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ name: 'youtubeChannelId', value: 'UCnew' });
  });

  it('refuses to save an empty secret, because empty means leave it alone', async () => {
    render(
      <SettingsManager
        initialSettings={[
          setting({ name: 'resendApiKey', label: 'Resend API key', secret: true, value: null }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/paste the new value/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('surfaces the server’s complaint rather than claiming success', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      json: async () => ({ success: false, error: 'A channel id starts with UC.' }),
    })) as unknown as typeof fetch;
    render(<SettingsManager initialSettings={[setting()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('A channel id starts with UC.')).toBeInTheDocument();
  });
});
