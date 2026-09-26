import { useEffect, useId, useRef, useState } from "react";
import { inputCls, selectCls } from "./Modal";

export interface MultiSelectOption {
  value: string;
  label: string;
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Choose",
  emptyText = "Nothing to choose",
  searchable = false,
}: {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = new Set(value);
  const labels = options.filter((option) => selected.has(option.value)).map((option) => option.label);
  const summary = labels.length ? labels.join(", ") : placeholder;
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((option) => option.label.toLowerCase().includes(q)) : options;

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(optionValue: string) {
    onChange(selected.has(optionValue) ? value.filter((item) => item !== optionValue) : [...value, optionValue]);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={`${selectCls} flex items-center justify-between gap-2 text-left`}
        aria-expanded={open}
        aria-controls={listId}
        title={labels.join(", ")}
        onClick={() => {
          setOpen((current) => !current);
          setQuery("");
        }}
      >
        <span className={`min-w-0 flex-1 truncate ${labels.length ? "text-gray-900" : "text-gray-400"}`}>{summary}</span>
        <span className="shrink-0 text-xs text-gray-400" aria-hidden>▾</span>
      </button>
      {open && (
        <div id={listId} className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {searchable && (
            <div className="sticky top-0 bg-white px-2 pb-1 pt-1">
              <input
                className={inputCls}
                value={query}
                placeholder="Search"
                autoFocus
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          )}
          {shown.length === 0 && <p className="px-3 py-2 text-sm text-gray-500">{emptyText}</p>}
          {shown.map((option) => {
            const on = selected.has(option.value);
            return (
              <button
                key={option.value}
                type="button"
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
                onClick={() => toggle(option.value)}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                    on ? "border-brand-primary bg-brand-primary text-white" : "border-gray-300 bg-white"
                  }`}
                  aria-hidden
                >
                  {on ? "✓" : ""}
                </span>
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
