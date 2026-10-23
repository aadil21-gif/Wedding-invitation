"use client";

import { dataOps, useData } from "@/lib/store";

/** Lets the user see, and delete, everything the assistant has stored on this phone. */
export function MemoryManager() {
  const data = useData();
  const listNames = Object.keys(data.lists);
  const empty = !data.facts.length && !data.notes.length && !listNames.length;

  return (
    <section aria-label="Memory" className="flex flex-col gap-3">
      <h2 className="font-bold">Memory on this phone</h2>
      <p className="text-sm opacity-80">
        Saved only on this device. Facts, notes and lists are sent to the AI provider with each
        question so the assistant can use them, and free providers may keep what they receive. Do
        not store passwords, card numbers or medical details here.
      </p>
      {empty && <p className="opacity-70">Nothing stored yet. Try: “Remember that my wife’s name is…”</p>}

      {data.facts.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="hud-label">FACTS</h3>
          {data.facts.map((f) => (
            <Row key={f} text={f} onDelete={() => dataOps.forget(f)} />
          ))}
        </div>
      )}
      {listNames.map((name) => (
        <div key={name} className="flex flex-col gap-2">
          <h3 className="hud-label">LIST · {name.toUpperCase()}</h3>
          {data.lists[name].map((item) => (
            <Row key={item} text={item} onDelete={() => dataOps.removeFromList(name, item)} />
          ))}
        </div>
      ))}
      {data.notes.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="hud-label">NOTES</h3>
          {data.notes.map((n) => (
            <Row key={n.id} text={n.text} onDelete={() => dataOps.deleteNote(n.id)} />
          ))}
        </div>
      )}
      {!empty && (
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Erase all memory, notes, lists, timers and reminders on this phone?")) {
              dataOps.clearAll();
            }
          }}
          className="touch-target rounded border-2 border-[var(--border)] px-4 font-bold"
        >
          Erase everything
        </button>
      )}
    </section>
  );
}

function Row({ text, onDelete }: { text: string; onDelete: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-[var(--border)] p-2">
      <span className="min-w-0 break-words">{text}</span>
      <button type="button" onClick={onDelete} className="shrink-0 rounded border-2 border-[var(--border)] px-3 py-1 font-bold">
        Delete
      </button>
    </div>
  );
}
