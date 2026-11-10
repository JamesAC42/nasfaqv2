import type { Metadata } from "next";
import { AuthForm } from "@/app/components/auth/auth-form";

export const metadata: Metadata = { title: "Make an account" };

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
