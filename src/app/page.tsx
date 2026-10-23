import { ChatDemo } from "@/components/ChatDemo";
import { SettingsPanel } from "@/components/SettingsPanel";

export default function Home() {
  return (
    <main className="flex-1 flex flex-col items-center gap-10 p-6 py-10">
      <header className="text-center">
        <h1 className="text-3xl font-bold">SeeFar</h1>
        <p className="opacity-80 mt-1">Milestone 0 — ask a question, see it answered.</p>
      </header>

      <ChatDemo />

      <details className="w-full max-w-xl rounded-lg border-2 border-[var(--border)] p-4">
        <summary className="font-bold text-lg cursor-pointer">Settings</summary>
        <div className="mt-4">
          <SettingsPanel />
        </div>
      </details>
    </main>
  );
}
