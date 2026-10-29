import { useState } from "react";
import { TAG_NAME_MAX, byName, cleanTagName, type Tag } from "@games/shared";
import { addTag, deleteTag, mergeTags, renameTag } from "../api";

/**
 * The shared Tag list: add, rename, merge one into another, delete (removes it from every Game).
 * `onGamesChanged` runs after a merge or delete, since those rewrite Games' Tags.
 */
export function Tags({ tags, onChange, onGamesChanged, onClose }: {
  tags: Tag[];
  onChange: (ts: Tag[]) => void;
  onGamesChanged: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string }>();
  const [merging, setMerging] = useState<{ id: string; intoId: string }>();
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
    const clean = cleanTagName(name);
    if (!clean) return;
    void run(async () => {
      onChange([...tags, await addTag(clean)].sort(byName));
      setName("");
    });
  };

  const saveRename = (e: React.FormEvent) => {
    e.preventDefault();
    const target = editing;
    const clean = target && cleanTagName(target.name);
    if (!target || !clean) return;
    void run(async () => {
      const renamed = await renameTag(target.id, clean);
      onChange(tags.map((t) => (t.id === renamed.id ? renamed : t)).sort(byName));
      setEditing(undefined);
    });
  };

  const saveMerge = (e: React.FormEvent) => {
    e.preventDefault();
    const target = merging;
    if (!target?.intoId) return;
    void run(async () => {
      await mergeTags(target.id, target.intoId);
      onChange(tags.filter((t) => t.id !== target.id));
      setMerging(undefined);
      onGamesChanged();
    });
  };

  const remove = (t: Tag) => {
    if (!confirm(`Delete Tag "${t.name}"? It comes off every Game.`)) return;
    void run(async () => {
      await deleteTag(t.id);
      onChange(tags.filter((x) => x.id !== t.id));
      onGamesChanged();
    });
  };

  return (
    <main>
      <header>
        <h1>Tags</h1>
        <button className="link" onClick={onClose}>Back to Games</button>
      </header>
      <form className="add" onSubmit={add}>
        <input placeholder="Add a Tag" value={name} onChange={(e) => setName(e.target.value)} maxLength={TAG_NAME_MAX} />
        <button className="primary" disabled={busy || !cleanTagName(name)}>Add</button>
      </form>
      {error && <p className="error">{error}</p>}
      <ul className="games">
        {tags.map((t) => (
          <li key={t.id} className="row">
            {editing?.id === t.id ? (
              <form className="add" onSubmit={saveRename}>
                <input value={editing.name} onChange={(e) => setEditing({ id: t.id, name: e.target.value })} maxLength={TAG_NAME_MAX} autoFocus />
                <button className="primary" disabled={busy || !cleanTagName(editing.name)}>Save</button>
                <button type="button" className="link" onClick={() => setEditing(undefined)}>Cancel</button>
              </form>
            ) : merging?.id === t.id ? (
              <form className="add" onSubmit={saveMerge}>
                <span>Merge “{t.name}” into</span>
                <select aria-label="Merge into" value={merging.intoId} onChange={(e) => setMerging({ id: t.id, intoId: e.target.value })}>
                  <option value="">Pick a Tag</option>
                  {tags.filter((x) => x.id !== t.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <button className="primary" disabled={busy || !merging.intoId}>Merge</button>
                <button type="button" className="link" onClick={() => setMerging(undefined)}>Cancel</button>
              </form>
            ) : (
              <>
                <span>{t.name}</span>
                <span>
                  <button className="link" disabled={busy} onClick={() => setEditing({ id: t.id, name: t.name })}>Rename</button>
                  <button className="link" disabled={busy || tags.length < 2} onClick={() => setMerging({ id: t.id, intoId: "" })}>Merge</button>
                  <button className="link" disabled={busy} onClick={() => remove(t)}>Delete</button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
