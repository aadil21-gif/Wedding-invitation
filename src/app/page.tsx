import { Console } from "@/components/Console";
import { SettingsPanel } from "@/components/SettingsPanel";

export default function Home() {
  return (
    <main className="flex-1 flex flex-col">
      <Console />
      <details className="w-full max-w-xl self-center rounded-lg border-2 border-[var(--border)] p-4 m-4">
        <summary className="font-bold text-lg cursor-pointer">Settings</summary>
        <div className="mt-4">
          <SettingsPanel />
        </div>
      </details>
    </main>
  );
}
