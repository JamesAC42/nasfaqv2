import { Suspense } from "react";
import { ChatApp } from "@/app/components/chat/chat-app";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ChatApp />
    </Suspense>
  );
}
