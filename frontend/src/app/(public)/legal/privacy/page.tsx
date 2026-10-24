import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '../legal-page';

export const metadata: Metadata = { title: 'Privacy policy' };

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated="24 October 2026">
      <p>This policy explains what personal data TeachMe collects, why, and the choices you have.</p>
      <h2>What we collect</h2>
      <ul>
        <li><strong>Account data:</strong> name, email, password (stored only as a salted Argon2id hash), timezone and optional phone number.</li>
        <li><strong>Learning and teaching data:</strong> bookings, session notes you choose to share, teacher profiles, availability and rates.</li>
        <li><strong>Payment data:</strong> payment status and Razorpay transaction identifiers. Card, UPI and bank details are handled by Razorpay and never reach our servers.</li>
        <li><strong>Calendar data (teachers):</strong> if you connect Google Calendar, an encrypted refresh token and the events we create for your sessions.</li>
        <li><strong>Technical data:</strong> IP address and browser information in security logs.</li>
      </ul>
      <h2>How we use it</h2>
      <ul>
        <li>To run bookings, payments, refunds, calendar events, Meet links and reminders.</li>
        <li>To keep the platform secure (rate limiting, fraud prevention, audit logs).</li>
        <li>To send transactional emails. Marketing emails are off unless you opt in.</li>
      </ul>
      <h2>Sharing</h2>
      <p>We share the minimum needed with: your teacher or student (name, session details and notes), Razorpay (payments), Google (calendar events and Meet for teachers who connect), and our email delivery provider. We do not sell personal data.</p>
      <h2>Retention</h2>
      <ul>
        <li>In-app notifications: 12 months. Security sessions and one-time tokens: up to 30 days after expiry.</li>
        <li>Booking and payment records: retained for financial record-keeping obligations even after account deletion, with contact details removed.</li>
        <li>Audit logs: retained for security investigations.</li>
      </ul>
      <h2>Your rights</h2>
      <p>From Settings you can download a copy of your data and delete your account. Deletion erases your profile and contact details immediately; financial records are kept in pseudonymised form. For any other request, <Link href="/contact" className="text-accent">contact support</Link>.</p>
      <h2>Security</h2>
      <p>All traffic is encrypted in transit (HTTPS). OAuth tokens are encrypted at rest with AES-256-GCM. Access to production data is restricted and audited.</p>
    </LegalPage>
  );
}
