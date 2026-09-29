import type { Metadata } from "next";
import { AuthForm } from "@/app/components/auth/auth-form";

export const metadata: Metadata = { title: "Forgot your password? | NASFAQ" };

export default function ForgotPasswordPage() {
  return <AuthForm mode="forgot" />;
}
