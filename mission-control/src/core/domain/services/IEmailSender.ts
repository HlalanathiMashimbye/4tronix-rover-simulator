/**
 * Email Sender Interface
 *
 * Domain layer defines the contract; infrastructure layer provides the
 * concrete implementation (Resend). Mirrors the IMissionRepository pattern
 * so notification logic can be unit tested with a mock sender.
 */

export interface IEmailSender {
  /**
   * Resolves to the sender's id for the email. Most callers ignore it; a reply
   * in the same thread needs it (see ResendEmailSender's `answering`).
   */
  send(to: string, subject: string, html: string): Promise<string>;
}
