import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DevSession } from "@/app/components/dev/dev-session";

export const metadata: Metadata = { title: "Dev session", robots: { index: false } };

// Local development only: borrow a session from the real site so signed-in
// pages can be checked against the production API without the captcha.
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DevSession apiBase={process.env.NEXT_PUBLIC_API_BASE ?? ""} />;
}
