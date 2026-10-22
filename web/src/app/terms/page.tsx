import type { Metadata } from 'next';
import Link from 'next/link';
import { LEGAL_CONTACT_EMAIL, LegalPage } from '@/components/legal-page';

export const metadata: Metadata = {
  title: 'Terms of Service — Kayaazh Payroll',
  description: 'The terms on which businesses and their people use Kayaazh Payroll.',
};

/** The terms of service. Plain language; the subscription facts match the sign-up and payment flow. */
export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro="The terms on which a business and its people use Kayaazh Payroll. By signing up, signing in or using the app, you agree to them."
    >
      <h2>1. The service</h2>
      <p>
        Kayaazh Payroll provides attendance with face and location verification, shift and leave management, expense
        claims, payroll calculation and payslips, notifications, and related reports, through this website, the
        Master Control web application, a branch kiosk and an Android app. We may improve or change features over
        time.
      </p>

      <h2>2. Accounts and workspaces</h2>
      <ul>
        <li>
          A business (&ldquo;customer&rdquo;) asks for a workspace through the sign-up page. A request is not an
          account: we review it, contact you, and open the workspace once it is confirmed and paid.
        </li>
        <li>
          The customer issues logins to its own administrators and employees and is responsible for who it gives
          access to, and for what is done with those logins.
        </li>
        <li>
          Keep your password and authenticator device to yourself, and tell us or your administrator promptly if
          you think someone else has used your account.
        </li>
      </ul>

      <h2>3. The customer&rsquo;s responsibilities</h2>
      <ul>
        <li>
          Tell its employees that their photos, face data and location are used for attendance, and obtain any
          consent the law requires, before switching these features on.
        </li>
        <li>
          Check payroll before paying it. Kayaazh Payroll calculates salaries from the attendance, leave and salary
          settings the customer provides and the rules it configures; it is a tool, not tax, legal or accounting
          advice, and the customer remains responsible for statutory compliance (such as PF, ESI, PT and TDS).
        </li>
        <li>Keep the information it enters accurate and lawful.</li>
      </ul>

      <h2>4. Acceptable use</h2>
      <p>You must not:</p>
      <ul>
        <li>try to reach another customer&rsquo;s data, or any data your login does not allow;</li>
        <li>check in for someone else, or interfere with the face or location checks;</li>
        <li>probe, overload or disrupt the service, or work around its security or rate limits;</li>
        <li>use the service for anything unlawful.</li>
      </ul>

      <h2>5. Subscription and payment</h2>
      <ul>
        <li>Plans and prices are shown on the <Link href="/pricing">pricing page</Link>. Fees are billed monthly in advance, plus applicable GST.</li>
        <li>A workspace opens once its first payment is received. If a payment is not made, the workspace may be suspended until it is; data is kept meanwhile.</li>
        <li>Payments are taken by our payment provider (Razorpay) or directly by arrangement with us.</li>
      </ul>

      <h2>6. Data</h2>
      <p>
        The customer owns the data in its workspace. We use it only to provide the service, as described in our{' '}
        <Link href="/privacy">Privacy Policy</Link>. When a customer leaves, it can ask us for its data and for its
        deletion.
      </p>

      <h2>7. Availability</h2>
      <p>
        We work to keep the service available and secure, but cannot promise it will never be interrupted —
        maintenance, outages of providers we rely on, or a phone without signal can all get in the way. Keep your
        own records of anything you must be able to produce at all times.
      </p>

      <h2>8. Liability</h2>
      <p>
        To the extent the law allows, the service is provided &ldquo;as is&rdquo;, we are not liable for indirect
        or consequential losses, and our total liability for any claim is limited to the fees the customer paid us in
        the three months before the claim arose.
      </p>

      <h2>9. Ending</h2>
      <p>
        A customer may stop using the service at any time. We may suspend or close a workspace that breaks these
        terms or is not paid for, after telling the customer where we reasonably can.
      </p>

      <h2>10. Changes and law</h2>
      <p>
        We may update these terms; the date at the top says when they last changed, and customers are told of
        significant changes before they take effect. These terms are governed by the laws of India, and disputes are
        subject to the jurisdiction of the courts of India.
      </p>

      <h2>11. Contact</h2>
      <p>
        <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>
      </p>
    </LegalPage>
  );
}
