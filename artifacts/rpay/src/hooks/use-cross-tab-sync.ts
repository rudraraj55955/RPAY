import { useEffect, useRef } from "react";

interface CrossTabSyncEntry {
  key: string;
  onUpdate: (rawValue: string | null) => void;
}

export function useCrossTabSync(entries: CrossTabSyncEntry[]): void {
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  useEffect(() => {
    const handler = (event: StorageEvent) => {
      for (const entry of entriesRef.current) {
        if (event.key === entry.key) {
          entry.onUpdate(event.newValue);
          break;
        }
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);
}
