import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | NASFAQ",
  description: "Privacy Policy for NASFAQ",
};

export default function PrivacyPage() {
  return (
    <main className="legalPage">
      <h1>Privacy Policy</h1>
      <p>Last updated: February 9, 2026</p>
      <p>NASFAQ uses YouTube API Services.</p>

      <h2>Public / Non-Authorized Data Only</h2>
      <p>
        NASFAQ only accesses public, non-authorized data available from YouTube API Services (for example: channel
        IDs, channel names, thumbnails, public subscriber/view/video counts, livestream status, and publish
        timestamps).
      </p>
      <p>
        NASFAQ does not use OAuth, does not request or use authorized scopes, and does not ask users to sign in with
        Google.
      </p>

      <h2>User Data Collection</h2>
      <ul>
        <li>We do not collect personal data from end users.</li>
        <li>We do not collect authorized user data from Google or YouTube accounts.</li>
      </ul>

      <h2>How We Use Information</h2>
      <ul>
        <li>To display public YouTube channel analytics and livestream data.</li>
        <li>To maintain, secure, and improve NASFAQ.</li>
      </ul>

      <h2>How We Share Information</h2>
      <ul>
        <li>We do not sell user data.</li>
        <li>We do not share personal user data because we do not collect personal user data.</li>
        <li>We may disclose information if required by law or to protect legal rights and security.</li>
      </ul>

      <h2>Cookies and Device Storage</h2>
      <p>
        NASFAQ and its service providers may store or access information on your device, including cookies, local
        storage, and similar technologies, to keep the service functioning, remember settings, analyze traffic, and
        improve reliability.
      </p>

      <h2>Data Retention and Deletion</h2>
      <p>
        NASFAQ does not retain personal user data because NASFAQ does not collect personal user data in the first
        place.
      </p>

      <h2>Revoking API Access</h2>
      <p>
        NASFAQ does not request authorized access to user Google/YouTube account data. If you want to review or revoke
        Google account connections generally, visit{" "}
        <a href="https://myaccount.google.com/connections?filters=3,4&hl=en" target="_blank" rel="noreferrer">
          https://myaccount.google.com/connections?filters=3,4&amp;hl=en
        </a>
        .
      </p>

      <h2>Third-Party Policies</h2>
      <p>
        Google Privacy Policy:{" "}
        <a href="http://www.google.com/policies/privacy" target="_blank" rel="noreferrer">
          http://www.google.com/policies/privacy
        </a>
      </p>

      <h2>Contact Information</h2>
      <p>
        For privacy questions or requests, contact <a href="mailto:nasfaqsite@gmail.com">nasfaqsite@gmail.com</a>.
      </p>

      <p>
        <Link href="/">Back to dashboard</Link>
      </p>
    </main>
  );
}
