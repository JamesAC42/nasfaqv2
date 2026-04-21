import { Suspense } from "react";
import { ChatPage } from "@/app/components/pages/chat-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ChatPage />
    </Suspense>
  );
}
