import { useState } from "react";
import { PLATFORM_NAME_MAX, byName, cleanPlatformName, type Platform } from "@games/shared";
import { addPlatform, deletePlatform, renamePlatform } from "../api";

/** The editable Platform list: add, rename, delete (a Platform in use can't be deleted). */
export function Platforms({ platforms, onChange, onClose }: {
  platforms: Platform[];
  onChange: (ps: Platform[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string }>();
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
    const clean = cleanPlatformName(name);
    if (!clean) return;
    void run(async () => {
      onChange([...platforms, await addPlatform(clean)].sort(byName));
      setName("");
    });
  };

  const saveRename = (e: React.FormEvent) => {
    e.preventDefault();
    const target = editing;
    const clean = target && cleanPlatformName(target.name);
    if (!target || !clean) return;
    void run(async () => {
      const renamed = await renamePlatform(target.id, clean);
      onChange(platforms.map((p) => (p.id === renamed.id ? renamed : p)).sort(byName));
      setEditing(undefined);
    });
  };

  const remove = (p: Platform) =>
    void run(async () => {
      await deletePlatform(p.id);
      onChange(platforms.filter((x) => x.id !== p.id));
    });

  return (
    <main>
      <header>
        <h1>Platforms</h1>
        <button className="link" onClick={onClose}>Back to Games</button>
      </header>
      <form className="add" onSubmit={add}>
        <input placeholder="Add a Platform" value={name} onChange={(e) => setName(e.target.value)} maxLength={PLATFORM_NAME_MAX} />
        <button className="primary" disabled={busy || !cleanPlatformName(name)}>Add</button>
      </form>
      {error && <p className="error">{error}</p>}
      <ul className="games">
        {platforms.map((p) => (
          <li key={p.id} className="row">
            {editing?.id === p.id ? (
              <form className="add" onSubmit={saveRename}>
                <input value={editing.name} onChange={(e) => setEditing({ id: p.id, name: e.target.value })} maxLength={PLATFORM_NAME_MAX} autoFocus />
                <button className="primary" disabled={busy || !cleanPlatformName(editing.name)}>Save</button>
                <button type="button" className="link" onClick={() => setEditing(undefined)}>Cancel</button>
              </form>
            ) : (
              <>
                <span>{p.name}</span>
                <span>
                  <button className="link" disabled={busy} onClick={() => setEditing({ id: p.id, name: p.name })}>Rename</button>
                  <button className="link" disabled={busy} onClick={() => remove(p)}>Delete</button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
