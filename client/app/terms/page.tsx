import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Use | NASFAQ",
  description: "Terms of Use for NASFAQ",
};

export default function TermsPage() {
  return (
    <main className="legalPage">
      <h1>Terms of Use</h1>
      <p>Last updated: February 9, 2026</p>

      <h2>Acceptance of Terms</h2>
      <p>
        By using NASFAQ, you agree to these Terms of Use and to be bound by the YouTube Terms of Service at{" "}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
          https://www.youtube.com/t/terms
        </a>
        .
      </p>

      <h2>YouTube API Services</h2>
      <p>
        NASFAQ uses YouTube API Services. YouTube content, metrics, and metadata shown in NASFAQ are provided subject
        to YouTube and Google policies and may be changed or removed at any time.
      </p>

      <h2>Permitted Use</h2>
      <p>
        You may use NASFAQ only in compliance with applicable law, these Terms, and all platform terms that govern the
        source data.
      </p>

      <h2>Contact</h2>
      <p>
        If you have questions about these Terms, contact us at{" "}
        <a href="mailto:nasfaqsite@gmail.com">nasfaqsite@gmail.com</a>.
      </p>

      <p>
        <Link href="/">Back to dashboard</Link>
      </p>
    </main>
  );
}
