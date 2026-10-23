"use client";

import { CHARACTER_LIST, type CharacterId } from "@/lib/characters";

/** Row of cartoon friends the child can pick from. */
export function CharacterPicker({ current, onPick }: { current: CharacterId; onPick: (id: CharacterId) => void }) {
  return (
    <div className="col-span-2 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Choose your friend">
      {CHARACTER_LIST.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-pressed={c.id === current}
          onClick={() => onPick(c.id)}
          className={`kid-tile touch-target shrink-0 flex flex-col items-center px-3 py-1 font-bold ${c.id === current ? "ring-4 ring-white" : "opacity-80"}`}
          style={{ background: c.color }}
        >
          <span className="text-3xl" aria-hidden>
            {c.emoji}
          </span>
          <span className="text-xs">{c.name}</span>
        </button>
      ))}
    </div>
  );
}
