import { useState, type ReactNode } from "react";

/** One action at a time: `busy` while it runs, its error message (if any) in `error`. */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

/** The frame of an editable list screen (Platforms, Accounts, Tags): title, back link, add form, error, rows. */
export function ListScreen({ title, onClose, addForm, error, children }: {
  title: string;
  onClose: () => void;
  addForm: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <main>
      <header>
        <h1>{title}</h1>
        <button className="link" onClick={onClose}>Back to Games</button>
      </header>
      {addForm}
      {error && <p className="error">{error}</p>}
      {children}
    </main>
  );
}

/**
 * A one-field form: a name input and a submit button ("Add" to add a row, "Save" with Cancel to
 * rename one). `clean` is the shared rule (e.g. cleanTagName): submitting is off until it accepts
 * the text, and `onSubmit` gets the cleaned name.
 */
export function NameForm({ value, onValueChange, clean, maxLength, busy, submitLabel, onSubmit, onCancel, placeholder, prefix }: {
  value: string;
  onValueChange: (value: string) => void;
  clean: (raw: unknown) => string | undefined;
  maxLength: number;
  busy: boolean;
  submitLabel: string;
  onSubmit: (clean: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  /** Shown before the input (e.g. an Account's Store). */
  prefix?: ReactNode;
}) {
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = clean(value);
    if (cleaned) onSubmit(cleaned);
  };
  return (
    <form className="add" onSubmit={submit}>
      {prefix}
      <input placeholder={placeholder} value={value} onChange={(e) => onValueChange(e.target.value)} maxLength={maxLength} autoFocus={!!onCancel} />
      <button className="primary" disabled={busy || !clean(value)}>{submitLabel}</button>
      {onCancel && <button type="button" className="link" onClick={onCancel}>Cancel</button>}
    </form>
  );
}
