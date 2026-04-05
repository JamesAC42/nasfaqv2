import Link from "next/link";
import { SiteShell } from "@/app/components/layout/site-shell";

export default async function Page({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  return (
    <SiteShell>
      <section style={{ display: "grid", gap: "0.75rem" }}>
        <h1 style={{ margin: 0 }}>Profile Page Coming Soon</h1>
        <p style={{ margin: 0 }}>
          Public profile pages are not wired up yet for <strong>{decodeURIComponent(username)}</strong>.
        </p>
        <p style={{ margin: 0 }}>
          <Link href="/articles">Back to articles</Link>
        </p>
      </section>
    </SiteShell>
  );
}
