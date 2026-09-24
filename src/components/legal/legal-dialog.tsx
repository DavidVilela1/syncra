"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { clsx } from "clsx";
import { Check, ScrollText, ShieldCheck, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LEGAL_DOCS, LEGAL_DOC_ORDER, isLegalDocId, type LegalDocId } from "~/lib/legal";

interface LegalDialogContextValue {
  open: (doc: LegalDocId) => void;
}

const LegalDialogContext = createContext<LegalDialogContextValue | null>(null);

const ICONS: Record<LegalDocId, ReactNode> = {
  privacy: <ShieldCheck className="size-4" />,
  terms: <ScrollText className="size-4" />,
};

/**
 * One dialog instance for the whole app, opened from any <LegalLink/>.
 *
 * • Accessible by construction (Radix Dialog): focus trap, Esc / outside-click
 *   to close, focus returns to the link that opened it, `aria-labelledby`.
 * • Deep-linkable: `/#privacy` or `/#terms` opens the right document, and the
 *   hash tracks the open tab — so "read our privacy policy" can be a plain URL.
 */
export function LegalDialogProvider({ children }: { children: ReactNode }) {
  const [doc, setDoc] = useState<LegalDocId | null>(null);
  /**
   * Element to return focus to on close. Radix does this automatically only
   * for its own <Dialog.Trigger>; our links open the dialog programmatically,
   * so we remember the opener ourselves (WCAG 2.4.3 focus order).
   */
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Open from the URL hash on load and on back/forward navigation.
  useEffect(() => {
    const syncFromHash = () => {
      const hash = window.location.hash.slice(1);
      if (isLegalDocId(hash)) setDoc(hash);
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  const writeHash = useCallback((next: LegalDocId | null) => {
    const url = new URL(window.location.href);
    url.hash = next ?? "";
    // replaceState: opening a modal shouldn't add history entries.
    window.history.replaceState(window.history.state, "", next ? url : url.pathname + url.search);
  }, []);

  const open = useCallback(
    (next: LegalDocId) => {
      // Only capture on the first open — tab switches inside the dialog must not overwrite it.
      if (!returnFocusTo.current && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
        returnFocusTo.current = document.activeElement;
      }
      setDoc(next);
      writeHash(next);
    },
    [writeHash],
  );

  const onOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        setDoc(null);
        writeHash(null);
      }
    },
    [writeHash],
  );

  const value = useMemo(() => ({ open }), [open]);

  return (
    <LegalDialogContext.Provider value={value}>
      {children}
      <Dialog.Root open={doc !== null} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in" />
          <Dialog.Content
            className={clsx(
              "fixed left-1/2 top-1/2 z-[61] flex max-h-[min(640px,calc(100dvh-2rem))] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col",
              "overflow-hidden rounded-2xl border border-white/10 bg-overlay shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9),0_0_60px_-24px_rgba(139,92,246,0.55)]",
              "focus:outline-none data-[state=closed]:animate-dialog-out data-[state=open]:animate-dialog-in",
            )}
            ref={contentRef}
            // Focus the dialog itself (screen readers announce its title) rather
            // than the × button, which would show a focus ring on every open.
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              contentRef.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              const target = returnFocusTo.current;
              returnFocusTo.current = null;
              if (target?.isConnected) {
                event.preventDefault();
                target.focus();
              }
            }}
          >
            {doc && <LegalDocument doc={doc} onSwitch={open} />}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </LegalDialogContext.Provider>
  );
}

function LegalDocument({ doc, onSwitch }: { doc: LegalDocId; onSwitch: (doc: LegalDocId) => void }) {
  const content = LEGAL_DOCS[doc];

  return (
    <>
      {/* Accent hairline */}
      <div aria-hidden className="h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent" />

      <header className="flex items-start gap-3 px-6 pb-4 pt-5">
        <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-accent/25 bg-accent-soft text-violet-300">
          {ICONS[doc]}
        </span>
        <div className="min-w-0 flex-1">
          <Dialog.Title className="text-[17px] font-semibold tracking-tight text-white">{content.title}</Dialog.Title>
          <Dialog.Description className="mt-0.5 text-[12.5px] text-zinc-500">
            Plain-language summary of how this demo works.
          </Dialog.Description>
        </div>
        <Dialog.Close
          aria-label="Close"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-all duration-200 hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
        >
          <X className="size-4" />
        </Dialog.Close>
      </header>

      {/* Segmented switch between the two documents */}
      <div className="px-6">
        <div role="tablist" aria-label="Legal documents" className="grid grid-cols-2 gap-1 rounded-xl border border-white/[0.06] bg-canvas/60 p-1">
          {LEGAL_DOC_ORDER.map((id) => {
            const active = id === doc;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSwitch(id)}
                className={clsx(
                  "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                  active
                    ? "bg-white/[0.07] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.06)_inset]"
                    : "text-zinc-500 hover:text-zinc-200",
                )}
              >
                <span className={active ? "text-accent" : undefined}>{ICONS[id]}</span>
                {LEGAL_DOCS[id].label}
              </button>
            );
          })}
        </div>
      </div>

      <div role="tabpanel" className="scrollbar-thin mt-5 min-h-0 flex-1 overflow-y-auto px-6 pb-2">
        <ul className="flex flex-wrap gap-2">
          {content.highlights.map((h) => (
            <li
              key={h}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.02] px-2.5 py-1 font-mono text-[10.5px] text-zinc-400"
            >
              <Check className="size-3 text-neon" strokeWidth={2.5} />
              {h}
            </li>
          ))}
        </ul>

        <div className="mt-5 space-y-4 border-l border-white/[0.06] pl-4">
          {content.paragraphs.map((p) => (
            <p key={p} className="text-pretty text-[14px] leading-7 text-zinc-300">
              {p}
            </p>
          ))}
        </div>
      </div>

      <footer className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.06] bg-canvas/40 px-6 py-3.5">
        <p className="font-mono text-[10.5px] text-zinc-600">Syncra · portfolio demo</p>
        <Dialog.Close className="inline-flex h-8 items-center rounded-lg bg-accent px-3.5 text-[12.5px] font-medium text-white shadow-[0_0_18px_-6px_rgba(139,92,246,0.9)] transition-all duration-200 hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-overlay">
          Understood
        </Dialog.Close>
      </footer>
    </>
  );
}

/**
 * Inline trigger. Renders a real `<a href="#privacy">`, so it's a meaningful
 * link without JS and middle-click/copy-link still produce a working URL.
 */
export function LegalLink({
  doc,
  children,
  className,
}: {
  doc: LegalDocId;
  children: ReactNode;
  className?: string;
}) {
  const ctx = useContext(LegalDialogContext);
  return (
    <a
      href={`#${doc}`}
      onClick={(event) => {
        if (!ctx) return; // no provider → fall back to the hash deep link
        event.preventDefault();
        ctx.open(doc);
      }}
      className={clsx(
        "underline-offset-4 transition-colors duration-200 hover:text-zinc-200 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        className,
      )}
    >
      {children}
    </a>
  );
}
