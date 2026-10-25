/**
 * Resend Email Client
 *
 * Reads server-only Resend credentials from the environment, following the
 * same descriptive-error style as firebase-admin.ts (normalize quotes/
 * whitespace, throw listing every missing variable) rather than introducing
 * a separate env-validation approach.
 */

import { readSetting } from '@/infrastructure/config/runtimeSettingsStore';
import { Resend } from 'resend';
import { IEmailSender } from '@/core/domain/services/IEmailSender';

let client: Resend | undefined;
let cachedKey: string | undefined;

type ResendConfig = {
  apiKey: string;
  fromEmail: string;
  sandboxRecipient?: string;
};


/**
 * Async now, because these are admin-editable at runtime rather than baked
 * into the instance's environment. readSetting still prefers the env var, so
 * local development and the tests carry on with a plain .env.
 */
async function getResendConfig(): Promise<ResendConfig> {
  const [apiKey, fromEmail] = await Promise.all([
    readSetting('resendApiKey'),
    readSetting('resendFromEmail'),
  ]);

  // Environment only, and not on the settings page. This redirects EVERY
  // learner email to one inbox; it existed for the months before the sending
  // domain was verified in Resend, and now that it is, arming it would
  // silently stop every child's mail. Local testing can still set it.
  const sandboxRecipient = process.env.RESEND_SANDBOX_RECIPIENT?.trim() || undefined;

  const missingVariables: string[] = [];

  if (!apiKey) {
    missingVariables.push('RESEND_API_KEY');
  }

  if (!fromEmail) {
    missingVariables.push('RESEND_FROM_EMAIL');
  }

  if (missingVariables.length > 0) {
    throw new Error(
      [
        `Missing Resend environment variables: ${missingVariables.join(', ')}.`,
        'Mission status emails use the Resend API.',
        'Set RESEND_API_KEY and RESEND_FROM_EMAIL in your server environment.',
      ].join(' ')
    );
  }

  return {
    apiKey: apiKey!,
    fromEmail: fromEmail!,
    sandboxRecipient,
  };
}

/**
 * Get the Resend client singleton.
 * Safe to call multiple times - only constructs once.
 */
export async function getResendClient(): Promise<Resend> {
  // Rebuilt when the key changes rather than cached forever: an admin who
  // rotates the Resend key from the settings page would otherwise keep
  // sending with the old one until the instance recycled, which is the exact
  // staleness this whole change exists to remove.
  const { apiKey } = await getResendConfig();
  if (client && cachedKey === apiKey) {
    return client;
  }

  cachedKey = apiKey;
  client = new Resend(apiKey);
  return client;
}

export type SendOptions = {
  /**
   * Resend's ids for earlier emails this one replies to, oldest first. The
   * email goes out as a reply in their thread: "Re:" on the subject, and
   * In-Reply-To and References naming them.
   */
  answering?: string[];
};

/**
 * The Message-ID header of each email, for the ones Resend can still find.
 *
 * Asked for at reply time, not kept at send time: Resend's send response
 * carries only its own id, and the Message-ID is what mail clients thread on.
 * A lookup that fails costs that email its place in the thread, not the reply.
 */
async function messageIdsOf(resend: Resend, emailIds: string[]): Promise<string[]> {
  const found = await Promise.all(
    emailIds.map(async (id) => {
      try {
        const { data } = await resend.emails.get(id);
        const messageId = data?.message_id?.trim();
        if (!messageId) return null;
        return messageId.startsWith('<') ? messageId : `<${messageId}>`;
      } catch {
        return null;
      }
    }),
  );
  return found.filter((id): id is string => id !== null);
}

export class ResendEmailSender implements IEmailSender {
  /** Returns Resend's id for the email, which is what `answering` takes later. */
  async send(to: string, subject: string, html: string, options: SendOptions = {}): Promise<string> {
    const { fromEmail, sandboxRecipient } = await getResendConfig();
    const resend = await getResendClient();

    // Sandbox mode. While RESEND_FROM_EMAIL is still onboarding@resend.dev,
    // Resend rejects every recipient except the address that owns the API key,
    // so a learner's real address is guaranteed to 403. Redirecting to that one
    // permitted inbox lets the full pipeline run end to end for a demo, with
    // the intended recipient kept visible in the subject so nobody mistakes a
    // redirected email for one that actually reached a learner.
    // Remove this by unsetting RESEND_SANDBOX_RECIPIENT once a real domain is
    // verified and RESEND_FROM_EMAIL points at it.
    const recipient = sandboxRecipient || to;
    const answering = options.answering ?? [];
    // "Re:" goes in front of the sandbox prefix, not behind it: the email
    // being answered had that prefix too, and clients match a reply's subject
    // to the original's with the "Re:" taken off.
    const finalSubject =
      (answering.length > 0 ? 'Re: ' : '') + (sandboxRecipient ? `[to: ${to}] ${subject}` : subject);

    if (sandboxRecipient) {
      console.warn(
        `[mission-email] SANDBOX redirect: ${to} -> ${sandboxRecipient} (no learner receives mail while RESEND_SANDBOX_RECIPIENT is set)`
      );
    }

    const thread = await messageIdsOf(resend, answering);
    if (thread.length < answering.length) {
      console.warn(`[email] ${answering.length - thread.length} of ${answering.length} earlier emails not found; the reply to ${to} may arrive on its own`);
    }

    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: recipient,
      subject: finalSubject,
      html,
      ...(thread.length > 0 && {
        headers: { 'In-Reply-To': thread[thread.length - 1], References: thread.join(' ') },
      }),
    });

    if (error) {
      throw new Error(`Resend failed to send email: ${error.message}`);
    }
    return data.id;
  }
}
