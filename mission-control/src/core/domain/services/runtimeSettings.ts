/**
 * The settings an admin can change without a deploy, declared once.
 *
 * RESEND_SANDBOX_RECIPIENT is deliberately NOT here. It redirects every
 * learner email to one inbox, and it existed only for the months before
 * marsyard.sapient.rocks was verified in Resend, when nothing could be sent
 * to a real address. The domain is verified, so arming it now would silently
 * stop every child's mail. It stays an environment variable, which a
 * developer can set locally and nobody can switch on from a web page.
 *
 * Same shape as the yard satellite's tunables.py, and for the same reason:
 * changing where mail comes from or which YouTube channel is watched should
 * not mean editing a tfvar, running terraform, and waiting for a rollout.
 * David should be able to swap a channel in a few clicks.
 *
 * `secret: true` only controls whether the VALUE may be read back out. Every
 * setting here lives in Secret Manager either way, secret or not, so there is
 * one store, one IAM model and one audit trail rather than a database for the
 * harmless ones and a vault for the rest.
 */

export type SettingGroup = 'email' | 'youtube';

export interface SettingSpec {
  /** Which card it belongs to. Five identical boxes in a row read as a form
   *  dump; two labelled groups read as the two things being configured. */
  group: SettingGroup;
  /** Secret Manager secret id, and the Terraform resource name. */
  secretId: string;
  /** Environment variable that overrides it, for local development. */
  envVar: string;
  label: string;
  help: string;
  /** When true the value is never returned to a browser, only its status. */
  secret: boolean;
  /** Rejects a value before it becomes a new version. */
  validate?: (value: string) => string | null;
}

function looksLikeEmail(value: string): string | null {
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value) ? null : 'That is not an email address.';
}

export const SETTINGS: Record<string, SettingSpec> = {
  resendApiKey: {
    group: 'email',
    secretId: 'resend-api-key',
    envVar: 'RESEND_API_KEY',
    label: 'Resend API key',
    help: 'Sends learner mission emails.',
    secret: true,
    validate: (v) => (v.startsWith('re_') ? null : 'Resend keys start with re_.'),
  },
  resendFromEmail: {
    group: 'email',
    secretId: 'resend-from-email',
    envVar: 'RESEND_FROM_EMAIL',
    label: 'Send mail from',
    help: 'Must be an address on a domain verified in Resend, or nothing sends.',
    secret: false,
    validate: looksLikeEmail,
  },
  youtubeLinkIntervalMinutes: {
    group: 'youtube',
    secretId: 'youtube-link-interval-minutes',
    envVar: 'YOUTUBE_LINK_INTERVAL_MINUTES',
    label: 'Check for uploads every',
    // The scheduler fires every 5 minutes and this decides how often that
    // actually does anything, so the floor is 5 and the knob only ever slows
    // it down. Changing the Cloud Scheduler job itself would mean the app
    // editing infrastructure Terraform owns, and the two would then fight
    // over it on every apply.
    help: 'Minutes between checks for new YouTube uploads. Minimum 5. A check that finds nothing is essentially free, so lower is fine.',
    secret: false,
    validate: (v) => {
      const n = Number(v);
      if (!Number.isInteger(n)) return 'Give a whole number of minutes.';
      if (n < 5) return 'The scheduler only runs every 5 minutes, so 5 is the floor.';
      if (n > 1440) return 'More than a day between checks is the same as off.';
      return null;
    },
  },
  youtubeApiKey: {
    group: 'youtube',
    secretId: 'youtube-api-key',
    envVar: 'YOUTUBE_API_KEY',
    label: 'YouTube API key',
    help: 'Reads the channel to find uploaded run videos.',
    secret: true,
  },
  youtubeChannelId: {
    group: 'youtube',
    secretId: 'youtube-channel-id',
    envVar: 'YOUTUBE_CHANNEL_ID',
    label: 'YouTube channel',
    help: 'The channel run videos are uploaded to. Starts with UC.',
    secret: false,
    validate: (v) => (v.startsWith('UC') ? null : 'A channel id starts with UC.'),
  },
};

export type SettingName = keyof typeof SETTINGS;

export function isSettingName(name: string): name is SettingName {
  return Object.hasOwn(SETTINGS, name);
}

/**
 * What a browser may know about a setting: whether it is configured, and the
 * value itself only when it is not a secret.
 */
export interface SettingStatus {
  name: string;
  group: SettingGroup;
  label: string;
  help: string;
  secret: boolean;
  configured: boolean;
  value: string | null;
}

export function describeSetting(name: SettingName, value: string | null): SettingStatus {
  const spec = SETTINGS[name];
  return {
    name,
    group: spec.group,
    label: spec.label,
    help: spec.help,
    secret: spec.secret,
    configured: value !== null && value !== '',
    // A secret's value never leaves the server. Not even masked: a mask that
    // shows the last four characters of an API key is four characters of an
    // API key on a screen somebody may be sharing.
    value: spec.secret ? null : value,
  };
}
