"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * Favourites — stored in localStorage, deliberately not in the database.
 *
 * The design says so explicitly on the favourites page: «تُحفظ على جهازك ولا
 * تحتاج حسابًا». Guests never sign in, so a server-side favourites list would
 * mean building an account system for a feature that works fine without one.
 *
 * Hydration note: `ids` starts empty on both server and client and is filled in
 * an effect *after* mount. Reading localStorage during render would make the
 * server HTML (no storage) disagree with the first client render (has storage),
 * and React would throw a hydration mismatch on the header's count badge. The
 * `ready` flag lets consumers hide counts until the real value is known instead
 * of flashing "٠".
 */

type FavoritesContextValue = {
  ids: string[];
  ready: boolean;
  isFavorite: (id: string) => boolean;
  toggle: (id: string) => void;
  clear: () => void;
  count: number;
};

const STORAGE_KEY = "desert-chalets:favorites";

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

function readStorage(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    // Private browsing / storage disabled — favourites simply don't persist.
    return [];
  }
}

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setIds(readStorage());
    setReady(true);

    // Keep multiple open tabs in sync.
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setIds(readStorage());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const persist = useCallback((next: string[]) => {
    setIds(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota / disabled storage: in-memory state still works this session.
    }
  }, []);

  const toggle = useCallback(
    (id: string) => {
      setIds((current) => {
        const next = current.includes(id)
          ? current.filter((x) => x !== id)
          : [...current, id];
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* see above */
        }
        return next;
      });
    },
    [],
  );

  const value = useMemo<FavoritesContextValue>(
    () => ({
      ids,
      ready,
      count: ids.length,
      isFavorite: (id: string) => ids.includes(id),
      toggle,
      clear: () => persist([]),
    }),
    [ids, ready, toggle, persist],
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext);
  if (!ctx) {
    throw new Error("useFavorites must be used inside <FavoritesProvider>");
  }
  return ctx;
}
