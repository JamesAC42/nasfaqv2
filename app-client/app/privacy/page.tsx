import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/app/components/layout/site-shell";

export const metadata: Metadata = {
  title: "Privacy Policy | NASFAQ",
  description: "Privacy Policy for NASFAQ",
};

export default function PrivacyPage() {
  return (
    <SiteShell>
      <section className="legalPage">
        <h1>Privacy Policy</h1>
        <p>Last updated: May 3, 2026</p>
        <p>NASFAQ uses YouTube API Services.</p>

        <h2>Public / Non-Authorized YouTube Data</h2>
        <p>
          For YouTube channel and video information shown in NASFAQ, we only access public, non-authorized data available
          from YouTube API Services, including channel IDs, channel names, thumbnails, public subscriber and view
          counts, livestream status, and publish timestamps.
        </p>
        <p>
          That public YouTube API usage does not rely on access to your private YouTube library or authorized YouTube
          account data beyond what Google provides when you sign in (described below).
        </p>

        <h2>Sign-In With Google</h2>
        <p>
          If you choose to sign in with Google OAuth, NASFAQ receives only the account information Google provides as
          part of that flow: typically your email address and the name associated with your Google account (“name”).
        </p>
        <ul>
          <li>We do not collect additional categories of personal data from Google beyond what OAuth returns for email and name.</li>
          <li>We do not scrape your Google profile, contacts, Gmail, Drive, or other Google products.</li>
        </ul>

        <h2>User Data Collection</h2>
        <ul>
          <li>
            Beyond the email address and name from Google OAuth (when you sign in), NASFAQ does not collect other personal
            data from end users.
          </li>
          <li>We do not request broad Google or YouTube authorized scopes unrelated to proving your identity for sign-in.</li>
        </ul>

        <h2>How We Use Information</h2>
        <ul>
          <li>To authenticate your account and keep you signed in securely.</li>
          <li>To display your chosen name within the service where relevant.</li>
          <li>To display public YouTube channel analytics and livestream data.</li>
          <li>To maintain, secure, and improve NASFAQ.</li>
        </ul>

        <h2>How We Share Information</h2>
        <ul>
          <li>We do not sell user data.</li>
          <li>We do not share your email or name for marketing by third parties.</li>
          <li>Hosting, infrastructure, and security vendors may process data only as needed to run NASFAQ.</li>
          <li>We may disclose information if required by law or to protect legal rights and security.</li>
        </ul>

        <h2>Cookies and Device Storage</h2>
        <p>
          NASFAQ and its service providers may store or access information on your device, including cookies, local
          storage, and similar technologies, to keep the service functioning, maintain your authenticated session after
          Google sign-in, remember settings, analyze traffic, and improve reliability.
        </p>

        <h2>Data Retention and Deletion</h2>
        <p>
          We retain the email address and name from Google OAuth only as long as needed to operate your account and the
          service. You may contact us to request deletion of associated account information, subject to any legal or
          security obligations we may have.
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
          <Link href="/">Back to home</Link>
        </p>
      </section>
    </SiteShell>
  );
}
