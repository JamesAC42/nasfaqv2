import type { Metadata } from "next";
import { AuthForm } from "@/app/components/auth/auth-form";

// The address holds a one-time reset token: no referrer, no indexing.
export const metadata: Metadata = { title: "Choose a new password | NASFAQ", referrer: "no-referrer", robots: { index: false } };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <AuthForm mode="reset" token={typeof token === "string" ? token : ""} />;
}
