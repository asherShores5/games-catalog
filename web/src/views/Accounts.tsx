import { useState } from "react";
import {
  ACCOUNT_NICKNAME_MAX, STORES, accountLabel, byAccountLabel, cleanAccountNickname, cleanSteamId,
  type Account, type SteamImportSummary, type Store,
} from "@games/shared";
import { addAccount, deleteAccount, importSteam, renameAccount, setSteamId } from "../api";

/**
 * The Account list: add (Store + nickname), rename the nickname, delete (an Account in use can't
 * be deleted). Steam Accounts also take a Steam ID and have "Import from Steam".
 */
export function Accounts({ accounts, onChange, onImported, onClose }: {
  accounts: Account[];
  onChange: (as: Account[]) => void;
  /** Called after an Import so the Game list (and Platforms: PC may be re-created) reload. */
  onImported: () => void;
  onClose: () => void;
}) {
  const [store, setStore] = useState<Store>("Steam");
  const [nickname, setNickname] = useState("");
  const [editing, setEditing] = useState<{ id: string; nickname: string }>();
  // The typed Steam ID lives only in this form state; it is sent once and never shown again.
  const [steamIdFor, setSteamIdFor] = useState<{ id: string; steamId: string }>();
  const [imported, setImported] = useState<{ id: string; summary: SteamImportSummary }>();
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

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = cleanAccountNickname(nickname);
    if (!clean) return;
    void run(async () => {
      onChange([...accounts, await addAccount(store, clean)].sort(byAccountLabel));
      setNickname("");
    });
  };

  const saveRename = (e: React.FormEvent) => {
    e.preventDefault();
    const target = editing;
    const clean = target && cleanAccountNickname(target.nickname);
    if (!target || !clean) return;
    void run(async () => {
      const renamed = await renameAccount(target.id, clean);
      onChange(accounts.map((a) => (a.id === renamed.id ? renamed : a)).sort(byAccountLabel));
      setEditing(undefined);
    });
  };

  const saveSteamId = (e: React.FormEvent) => {
    e.preventDefault();
    const target = steamIdFor;
    const clean = target && cleanSteamId(target.steamId);
    if (!target || !clean) return;
    void run(async () => {
      const updated = await setSteamId(target.id, clean);
      onChange(accounts.map((a) => (a.id === updated.id ? updated : a)));
      setSteamIdFor(undefined);
    });
  };

  const runImport = (a: Account) =>
    void run(async () => {
      setImported(undefined);
      setImported({ id: a.id, summary: await importSteam(a.id) });
      onImported();
    });

  const remove = (a: Account) =>
    void run(async () => {
      await deleteAccount(a.id);
      onChange(accounts.filter((x) => x.id !== a.id));
    });

  return (
    <main>
      <header>
        <h1>Accounts</h1>
        <button className="link" onClick={onClose}>Back to Games</button>
      </header>
      <form className="add" onSubmit={add}>
        <select value={store} onChange={(e) => setStore(e.target.value as Store)} aria-label="Store">
          {STORES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <input placeholder="Nickname, e.g. main" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={ACCOUNT_NICKNAME_MAX} />
        <button className="primary" disabled={busy || !cleanAccountNickname(nickname)}>Add</button>
      </form>
      {error && <p className="error">{error}</p>}
      {accounts.length === 0 && <p className="empty">No Accounts yet. Digital Copies need one.</p>}
      <ul className="games">
        {accounts.map((a) => (
          <li key={a.id} className="row">
            {editing?.id === a.id ? (
              <form className="add" onSubmit={saveRename}>
                <span>{a.store}:</span>
                <input
                  value={editing.nickname}
                  onChange={(e) => setEditing({ id: a.id, nickname: e.target.value })}
                  maxLength={ACCOUNT_NICKNAME_MAX}
                  autoFocus
                />
                <button className="primary" disabled={busy || !cleanAccountNickname(editing.nickname)}>Save</button>
                <button type="button" className="link" onClick={() => setEditing(undefined)}>Cancel</button>
              </form>
            ) : steamIdFor?.id === a.id ? (
              <form className="add" onSubmit={saveSteamId}>
                <input
                  placeholder="Steam ID (17 digits, 7656119…)"
                  aria-label="Steam ID"
                  inputMode="numeric"
                  autoComplete="off"
                  value={steamIdFor.steamId}
                  onChange={(e) => setSteamIdFor({ id: a.id, steamId: e.target.value })}
                  maxLength={17}
                  autoFocus
                />
                <button className="primary" disabled={busy || !cleanSteamId(steamIdFor.steamId)}>Save</button>
                <button type="button" className="link" onClick={() => setSteamIdFor(undefined)}>Cancel</button>
              </form>
            ) : (
              <>
                <span>
                  {accountLabel(a)}
                  {imported?.id === a.id && <ImportSummary summary={imported.summary} />}
                </span>
                <span>
                  {a.store === "Steam" && (
                    <>
                      <button className="link" disabled={busy} onClick={() => setSteamIdFor({ id: a.id, steamId: "" })}>
                        {a.hasSteamId ? "Change Steam ID" : "Set Steam ID"}
                      </button>
                      <button className="link" disabled={busy || !a.hasSteamId} onClick={() => runImport(a)}
                        title={a.hasSteamId ? undefined : "Set a Steam ID first"}>Import from Steam</button>
                    </>
                  )}
                  <button className="link" disabled={busy} onClick={() => setEditing({ id: a.id, nickname: a.nickname })}>Rename</button>
                  <button className="link" disabled={busy} onClick={() => remove(a)}>Delete</button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}

/** "Added 3, 12 already present" plus the added names. */
function ImportSummary({ summary: s }: { summary: SteamImportSummary }) {
  return (
    <small className="summary">
      {" "}Added {s.added}, {s.alreadyPresent} already present{s.failed > 0 && `, ${s.failed} failed (run it again to retry)`}.
      {s.addedNames.length > 0 && ` New: ${s.addedNames.join(", ")}.`}
    </small>
  );
}
