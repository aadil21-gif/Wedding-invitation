import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-2xl font-bold">SeeFar</h1>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
