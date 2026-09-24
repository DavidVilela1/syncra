/**
 * Legal copy — kept as data, verbatim, so the modal, any future /privacy page
 * and tests all render exactly the same approved text.
 */
export type LegalDocId = "privacy" | "terms";

export interface LegalDoc {
  id: LegalDocId;
  title: string;
  /** Short tab label. */
  label: string;
  /** Scannable summary chips derived from the text below. */
  highlights: readonly string[];
  paragraphs: readonly string[];
}

export const LEGAL_DOCS: Record<LegalDocId, LegalDoc> = {
  privacy: {
    id: "privacy",
    title: "Syncra - Privacy Policy",
    label: "Privacy Policy",
    highlights: ["No PII collected", "No tracking cookies", "Ephemeral sandbox data"],
    paragraphs: [
      "Syncra is an open-source development portfolio project. We do not collect, store, or track any Personal Identifiable Information (PII). No email addresses, names, or tracking cookies are processed or shared with third parties.",
      "Any text or data you input into the temporary Kanban boards is ephemeral, stored anonymously in a demonstration database sandbox, and is periodically wiped.",
      "By using this live demo, you acknowledge that this is a testing environment and no sensitive or personal data should be uploaded.",
    ],
  },
  terms: {
    id: "terms",
    title: "Syncra - Terms of Service",
    label: "Terms of Service",
    highlights: ["Provided as-is", "No persistence guarantees", "No malicious content"],
    paragraphs: [
      "Welcome to Syncra. This application is provided strictly as-is for demonstration and portfolio inspection purposes.",
      "We offer no guarantees regarding data persistence, uptime, or security for stored information.",
      "You agree not to use this platform to post malicious, offensive, or illegal content.",
      "We reserve the right to wipe the demonstration sandbox database at any time without prior notice.",
    ],
  },
};

export const LEGAL_DOC_ORDER: readonly LegalDocId[] = ["privacy", "terms"];

export function isLegalDocId(value: string): value is LegalDocId {
  return value === "privacy" || value === "terms";
}
