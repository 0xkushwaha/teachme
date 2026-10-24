import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '../legal-page';

export const metadata: Metadata = { title: 'Terms of service' };

export default function Terms() {
  return (
    <LegalPage title="Terms of service" updated="24 October 2026">
      <p>These terms govern your use of TeachMe, a marketplace that connects students with independent teachers for live online sessions. By creating an account you agree to them.</p>
      <h2>1. Accounts</h2>
      <ul>
        <li>You must provide accurate information and keep your password confidential. You are responsible for activity on your account.</li>
        <li>Students under 18 should use TeachMe with the involvement of a parent or guardian.</li>
        <li>We may suspend accounts that breach these terms, misuse the platform or put other users at risk.</li>
      </ul>
      <h2>2. Teachers</h2>
      <ul>
        <li>Teachers are independent providers, not employees of TeachMe. Profiles are reviewed before they are published, but teachers are responsible for the accuracy of their qualifications and the quality of their sessions.</li>
        <li>Teachers agree to keep their availability up to date and to attend confirmed sessions.</li>
      </ul>
      <h2>3. Bookings and payment</h2>
      <ul>
        <li>A booking is confirmed only after payment has been verified by our payment processor, Razorpay. The price, platform fee and taxes are shown before you pay.</li>
        <li>Slots are reserved for a short time during checkout; if payment does not complete in time, the reservation lapses.</li>
        <li>Cancellations, rescheduling and refunds follow the <Link href="/legal/cancellation" className="text-accent">cancellation & refund policy</Link> shown at the time of booking.</li>
      </ul>
      <h2>4. Sessions</h2>
      <p>Sessions take place on Google Meet. Participants must behave respectfully. Recording a session requires the consent of everyone present.</p>
      <h2>5. Acceptable use</h2>
      <p>You may not use TeachMe to harass others, arrange payments outside the platform for sessions found through it, attempt to access other users’ data, or interfere with the service’s security.</p>
      <h2>6. Liability</h2>
      <p>TeachMe provides the platform “as is”. To the extent permitted by law, our liability for any claim relating to a session is limited to the amount you paid for that session.</p>
      <h2>7. Changes and contact</h2>
      <p>We may update these terms and will notify registered users of material changes. Questions: <Link href="/contact" className="text-accent">contact support</Link>.</p>
    </LegalPage>
  );
}
