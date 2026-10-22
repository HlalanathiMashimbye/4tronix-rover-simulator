import { redirect } from 'next/navigation';

/**
 * The terms are the second half of the privacy page; this is the address for
 * them on their own, which Google's consent screen asks for beside the privacy
 * one. The anchor must match the one on app/privacy/page.tsx, and
 * privacyPage.test.tsx checks that it does.
 */
export default function TermsPage() {
  redirect('/privacy#terms');
}
