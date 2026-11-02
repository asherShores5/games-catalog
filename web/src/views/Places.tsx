import { useState } from "react";
import { PLACE_NAME_MAX, byName, cleanPlaceName, type Place, type Platform } from "@games/shared";
import { addPlace, deletePlace, renamePlace, setPlacePlatforms } from "../api";
import { ListScreen, NameForm, useBusy } from "./ListScreen";

/**
 * Where I play: each Place lists the Platforms there (tap to add or take one off). A Platform can
 * be in several Places. The Place filter then shows Games with a Copy on any of them.
 */
export function Places({ places, platforms, onChange, onClose }: {
  places: Place[];
  platforms: Platform[];
  onChange: (ps: Place[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string }>();
  const { busy, error, run } = useBusy();
  const replace = (p: Place) => onChange(places.map((x) => (x.id === p.id ? p : x)).sort(byName));

  const add = (clean: string) =>
    void run(async () => {
      onChange([...places, await addPlace(clean)].sort(byName));
      setName("");
    });
  const rename = (id: string, clean: string) =>
    void run(async () => {
      replace(await renamePlace(id, clean));
      setEditing(undefined);
    });
  const toggle = (place: Place, platformId: string) =>
    void run(async () => {
      const ids = place.platformIds.includes(platformId)
        ? place.platformIds.filter((x) => x !== platformId)
        : [...place.platformIds, platformId];
      replace(await setPlacePlatforms(place.id, ids));
    });
  const remove = (p: Place) => {
    if (!confirm(`Delete Place "${p.name}"? Its Platforms and Games stay as they are.`)) return;
    void run(async () => {
      await deletePlace(p.id);
      onChange(places.filter((x) => x.id !== p.id));
    });
  };

  return (
    <ListScreen
      title="Places"
      onClose={onClose}
      error={error}
      addForm={
        <NameForm value={name} onValueChange={setName} clean={cleanPlaceName} maxLength={PLACE_NAME_MAX} busy={busy}
          submitLabel="Add" placeholder="Add a Place, e.g. Couch" onSubmit={add} />
      }
    >
      {places.length === 0 && <p className="empty">No Places yet. Add one for each spot you play, then tap its Platforms.</p>}
      <ul className="games">
        {places.map((p) => (
          <li key={p.id} className="place">
            <div className="row">
              {editing?.id === p.id ? (
                <NameForm value={editing.name} onValueChange={(v) => setEditing({ id: p.id, name: v })} clean={cleanPlaceName}
                  maxLength={PLACE_NAME_MAX} busy={busy} submitLabel="Save" onSubmit={(clean) => rename(p.id, clean)}
                  onCancel={() => setEditing(undefined)} />
              ) : (
                <>
                  <span className="place-name">{p.name}</span>
                  <span>
                    <button className="link" disabled={busy} onClick={() => setEditing({ id: p.id, name: p.name })}>Rename</button>
                    <button className="link danger" disabled={busy} onClick={() => remove(p)}>Delete</button>
                  </span>
                </>
              )}
            </div>
            <div className="chips" role="group" aria-label={`Platforms at ${p.name}`}>
              {platforms.map((pl) => {
                const on = p.platformIds.includes(pl.id);
                return (
                  <button key={pl.id} className={on ? "chip on" : "chip"} aria-pressed={on} disabled={busy} onClick={() => toggle(p, pl.id)}>
                    {pl.name}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </ListScreen>
  );
}
