import type { Metadata } from 'next';
import Link from 'next/link';
import { LEGAL_CONTACT_EMAIL, LegalPage } from '@/components/legal-page';

export const metadata: Metadata = {
  title: 'Privacy Policy — Kayaazh Payroll',
  description: 'What Kayaazh Payroll collects, why, who it is shared with, how long it is kept, and your rights.',
};

/**
 * The privacy policy. Written to match what the product actually does — every
 * category of data and every outside service named here is one the code uses.
 * Change both together.
 */
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="What Kayaazh Payroll collects, why it collects it, who else handles it, and what you can ask us to do with it."
    >
      <h2>1. Who we are</h2>
      <p>
        Kayaazh Payroll (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is an attendance, HR and payroll service for businesses
        such as multi-branch dealerships. It consists of this website, the Master Control web application used by a
        business&rsquo;s administrators, a branch kiosk, and the Kayaazh Payroll Android app used by its employees.
      </p>
      <p>
        Each business that uses Kayaazh Payroll (a &ldquo;customer&rdquo;) has its own workspace. For the personal
        data of its employees, the customer decides what is collected and why, and we process it on the
        customer&rsquo;s behalf and on its instructions. For the data of people who sign up, contact us or use our
        own website, we decide.
      </p>

      <h2>2. What we collect</h2>
      <h3>People who sign up for a workspace</h3>
      <ul>
        <li>Name, contact number, email address, organisation name and GST number.</li>
        <li>
          If you choose <strong>Sign up with Google</strong> or <strong>Sign in with Google</strong>: your Google
          account&rsquo;s email address, whether Google has verified it, and your name. We receive nothing else from
          Google — no contacts, files, calendar or other account data.
        </li>
        <li>The plan you choose, and payment status. Card and bank details are entered with our payment provider (Razorpay) and never reach us.</li>
      </ul>

      <h3>Administrators of a workspace</h3>
      <ul>
        <li>Name, email address, role and branch.</li>
        <li>A password, stored only as a one-way hash, and the secret for two-step verification, with recovery codes stored only as hashes.</li>
        <li>A record of the administrative actions taken (the audit log), with time and IP address.</li>
      </ul>

      <h3>Employees of a customer</h3>
      <ul>
        <li>Identity and employment details: name, employee code, phone number, email (if given), branch, department, designation, shift, joining date.</li>
        <li>
          <strong>Photographs and face data:</strong> a reference photo provided by the employer and a selfie at each
          check-in and check-out. Faces are compared using Amazon Rekognition to confirm the right person is
          checking in; the face template is held in Rekognition, not as an image in our database.
        </li>
        <li>
          <strong>Location:</strong> GPS coordinates at check-in and check-out, used to confirm the employee is at
          their branch, and — where the employer enables live tracking — the phone&rsquo;s location every two
          minutes from check-in until check-out. The app tells the employee when this starts and stops, shows a
          notification the whole time, and records nothing after check-out or sign-out. Employees agree to this in
          the app before they first use it.
        </li>
        <li>Attendance times, breaks, leave requests and supporting documents, expense claims and their bills.</li>
        <li>Salary, allowances, deductions (such as PF and ESI) and payslips.</li>
        <li>Device information needed to run the app and send notifications (such as a push notification token and app version).</li>
      </ul>

      <h3>Everyone who visits</h3>
      <p>
        Standard technical information our servers receive with any request (IP address, browser type, time). We do
        not use advertising or analytics cookies and do not sell or rent personal data. The web applications keep
        your signed-in session and chosen workspace in your browser&rsquo;s local storage.
      </p>

      <h2>3. Why we use it</h2>
      <ul>
        <li>To provide the service: record attendance, verify identity and location, manage shifts and leave, and calculate payroll.</li>
        <li>To prevent attendance fraud — the face match and location check exist so that no one can check in for someone else.</li>
        <li>To sign people in securely, including two-step verification and password reset emails.</li>
        <li>To send notifications the employer has switched on (app notifications, WhatsApp messages, emails).</li>
        <li>To review sign-up requests, contact you about them, and take payment.</li>
        <li>To keep the service secure, investigate misuse, and meet legal obligations.</li>
      </ul>

      <h2>4. Who else handles it</h2>
      <p>We use these service providers, each only for the purpose listed:</p>
      <ul>
        <li><strong>Railway</strong> — hosting of the application and its database.</li>
        <li><strong>Amazon Web Services</strong> (Mumbai region) — face comparison (Rekognition) and file storage (S3).</li>
        <li><strong>Google</strong> — Sign in / Sign up with Google; Google Drive, where a customer chooses it, for claim bills; Gmail for sending password reset emails.</li>
        <li><strong>Firebase Cloud Messaging</strong> (Google) — app notifications.</li>
        <li><strong>WhatsApp messaging providers</strong> (Meta, Twilio or WATI) — WhatsApp messages the employer has switched on.</li>
        <li><strong>Razorpay</strong> — subscription payments.</li>
      </ul>
      <p>
        Data is otherwise shared only with the customer that the workspace belongs to, or where the law requires
        it. One customer can never see another customer&rsquo;s data.
      </p>

      <h2>5. Google user data</h2>
      <p>
        Kayaazh Payroll&rsquo;s use and transfer of information received from Google APIs adheres to the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. We use the email address and name from Google only to identify
        you when you sign up or sign in. We do not use it for advertising, do not sell it, and do not let anyone
        read it except as needed to run the service.
      </p>

      <h2>6. How long we keep it</h2>
      <p>
        Workspace data is kept while the customer&rsquo;s subscription is active, so that attendance and payroll
        history stays complete. Live-tracking location history is the exception: it is deleted automatically after 180 days. When a customer leaves, we delete its workspace data on its request, except records
        we must keep by law. Sign-up requests that do not become a workspace are deleted on request. Deactivated
        employees are removed from reports but their past attendance and payroll records stay with the
        customer&rsquo;s history.
      </p>

      <h2>7. How we protect it</h2>
      <ul>
        <li>Encrypted connections (HTTPS) for all traffic; a database encrypted at rest by the hosting provider.</li>
        <li>Each customer&rsquo;s data is separated from every other customer&rsquo;s at the database level.</li>
        <li>Passwords and recovery codes stored only as hashes; two-step verification required for every administrator.</li>
        <li>An audit log of administrative actions.</li>
      </ul>

      <h2>8. Your rights</h2>
      <p>
        Under India&rsquo;s Digital Personal Data Protection Act, 2023 and other applicable law, you may ask to
        access, correct or erase your personal data, withdraw consent, and raise a grievance. If you are an
        employee of one of our customers, please contact your employer first — they control your workspace data and
        we act on their instructions. You can always write to us, and we will respond within 30 days.
      </p>

      <h2>9. Children</h2>
      <p>Kayaazh Payroll is a workplace service and is not intended for anyone under 18.</p>

      <h2>10. Changes</h2>
      <p>
        If we change this policy we will update the date at the top of this page, and tell customers about
        significant changes before they take effect.
      </p>

      <h2>11. Contact</h2>
      <p>
        Questions, requests or grievances: <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>. See
        also our <Link href="/terms">Terms of Service</Link>.
      </p>
    </LegalPage>
  );
}
