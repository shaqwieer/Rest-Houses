"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import clsx from "clsx";
import { Icon } from "./icon";

/**
 * Toast notifications — the design's floating confirmation pill.
 *
 * Used for every admin mutation so the owner gets confirmation without a page
 * of inline status text. `role="status"` + `aria-live="polite"` means a screen
 * reader announces it without stealing focus mid-task.
 */

type Toast = { id: number; message: string; tone: "ok" | "error" };

type ToastContextValue = {
  toast: (message: string, tone?: "ok" | "error") => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, tone: "ok" | "error" = "ok") => {
    // Date.now() is fine as a key here: two toasts can't be created in the same
    // millisecond from a single user action.
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-9999 flex flex-col items-center gap-2 px-4 md:bottom-7"
      >
        {toasts.map((t) => (
          <ToastPill
            key={t.id}
            toast={t}
            onDone={() => setToasts((current) => current.filter((x) => x.id !== t.id))}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastPill({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  useEffect(() => {
    // Errors linger: they usually need reading and sometimes acting on.
    const ms = toast.tone === "error" ? 5000 : 2600;
    const timer = setTimeout(onDone, ms);
    return () => clearTimeout(timer);
  }, [toast.tone, onDone]);

  return (
    <div
      className={clsx(
        "animate-pop-in pointer-events-auto flex max-w-[92vw] items-center gap-2.5 rounded-full px-5 py-3.5 text-[14px] font-bold shadow-[0_18px_44px_rgb(0_0_0/0.4)]",
        toast.tone === "ok"
          ? "border border-gold-500/30 bg-night-900 text-sand-50"
          : "border border-busy bg-busy text-white",
      )}
    >
      <Icon
        name={toast.tone === "ok" ? "check_circle" : "error"}
        size={19}
        className={toast.tone === "ok" ? "text-gold-500" : "text-white"}
      />
      {toast.message}
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  // A no-op fallback keeps components usable outside the provider (e.g. in a
  // future public-site context) rather than throwing at render time.
  return ctx ?? { toast: () => undefined };
}
