import { useState } from "react";
import { byName, cleanTagName, sameTagName, type Game, type Tag } from "@games/shared";
import { addGameTag, addTag, removeGameTag } from "../api";

/**
 * One opened Game's Tags: remove one, or add one from the list (typing a new name creates the
 * Tag first). Imported Tags are marked so I can tell them apart.
 */
export function GameTags({ game, tags, onChange, onTagsChange }: {
  game: Game;
  tags: Tag[];
  onChange: (g: Game) => void;
  onTagsChange: (ts: Tag[]) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const tagName = (id: string) => tags.find((t) => t.id === id)?.name;
  const linked = new Set(game.tags.map((t) => t.tagId));
  const choices = tags.filter((t) => !linked.has(t.id));

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
      let tag = tags.find((t) => sameTagName(t.name, clean));
      if (!tag) {
        tag = await addTag(clean);
        onTagsChange([...tags, tag].sort(byName));
      }
      onChange(await addGameTag(game.id, tag.id));
      setName("");
    });
  };

  return (
    <div className="detail">
      <ul className="tag-list">
        {game.tags.map((t) => {
          const n = tagName(t.tagId);
          // A link to a Tag missing from the list (deleted elsewhere) isn't worth showing.
          if (!n) return null;
          return (
            <li key={t.tagId} className="badge" title={t.source === "Import" ? "From an Import" : "Added by hand"}>
              {n}
              {t.source === "Import" && " ⇣"}{" "}
              <button className="link" aria-label={`Remove Tag ${n}`} disabled={busy} onClick={() => void run(async () => onChange(await removeGameTag(game.id, t.tagId)))}>×</button>
            </li>
          );
        })}
        {game.tags.length === 0 && <li className="empty">No Tags.</li>}
      </ul>
      <form className="add" onSubmit={add}>
        <input list={`tag-choices-${game.id}`} placeholder="Add a Tag" aria-label="Add a Tag" value={name} onChange={(e) => setName(e.target.value)} />
        <datalist id={`tag-choices-${game.id}`}>
          {choices.map((t) => <option key={t.id} value={t.name} />)}
        </datalist>
        <button className="primary" disabled={busy || !cleanTagName(name)}>Add Tag</button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
