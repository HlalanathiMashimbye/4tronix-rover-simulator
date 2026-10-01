/**
 * The email an admin gets when someone asks for operator access.
 *
 * One button, straight to the grant form with the address filled in, because
 * the admin reading this is usually on a phone between other jobs: anything
 * that means copying an email address across is a step that does not happen.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildAccessRequestEmail(requesterEmail: string, grantUrl: string) {
  const who = escapeHtml(requesterEmail);
  const href = escapeHtml(grantUrl);

  return {
    subject: `${requesterEmail} is asking for operator access`,
    html: `
      <div style="font-family: Inter, Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #1f1f1f;">
        <h2 style="font-size: 20px; margin: 0 0 12px;">Operator access request</h2>
        <p style="font-size: 15px; line-height: 1.5; margin: 0 0 16px;">
          <strong>${who}</strong> signed in to Mission Control with Google and does not have
          operator access yet. They asked an admin to let them in.
        </p>
        <p style="margin: 0 0 20px;">
          <a href="${href}" style="display: inline-block; background: #1f1f1f; color: #ffffff; text-decoration: none; font-weight: 700; padding: 12px 20px; border-radius: 12px;">
            Review and grant access
          </a>
        </p>
        <p style="font-size: 13px; line-height: 1.5; color: #666; margin: 0;">
          The link opens Manage access with their address filled in. Nothing is granted until
          you press Grant access. If you do not know this person, ignore this email.
        </p>
      </div>
    `,
  };
}
