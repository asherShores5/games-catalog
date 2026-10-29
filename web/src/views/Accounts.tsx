import { useState } from "react";
import { ACCOUNT_NICKNAME_MAX, STORES, accountLabel, byAccountLabel, cleanAccountNickname, type Account, type Store } from "@games/shared";
import { addAccount, deleteAccount, renameAccount } from "../api";

/** The Account list: add (Store + nickname), rename the nickname, delete (an Account in use can't be deleted). */
export function Accounts({ accounts, onChange, onClose }: {
  accounts: Account[];
  onChange: (as: Account[]) => void;
  onClose: () => void;
}) {
  const [store, setStore] = useState<Store>("Steam");
  const [nickname, setNickname] = useState("");
  const [editing, setEditing] = useState<{ id: string; nickname: string }>();
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
            ) : (
              <>
                <span>{accountLabel(a)}</span>
                <span>
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
