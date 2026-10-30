import { useState } from "react";
import { PLATFORM_NAME_MAX, byName, cleanPlatformName, type Platform } from "@games/shared";
import { addPlatform, deletePlatform, renamePlatform } from "../api";
import { ListScreen, NameForm, useBusy } from "./ListScreen";

/** The editable Platform list: add, rename, delete (a Platform in use can't be deleted). */
export function Platforms({ platforms, onChange, onClose }: {
  platforms: Platform[];
  onChange: (ps: Platform[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string }>();
  const { busy, error, run } = useBusy();

  const add = (clean: string) =>
    void run(async () => {
      onChange([...platforms, await addPlatform(clean)].sort(byName));
      setName("");
    });

  const rename = (id: string, clean: string) =>
    void run(async () => {
      const renamed = await renamePlatform(id, clean);
      onChange(platforms.map((p) => (p.id === renamed.id ? renamed : p)).sort(byName));
      setEditing(undefined);
    });

  const remove = (p: Platform) =>
    void run(async () => {
      await deletePlatform(p.id);
      onChange(platforms.filter((x) => x.id !== p.id));
    });

  return (
    <ListScreen
      title="Platforms"
      onClose={onClose}
      error={error}
      addForm={
        <NameForm value={name} onValueChange={setName} clean={cleanPlatformName} maxLength={PLATFORM_NAME_MAX} busy={busy}
          submitLabel="Add" placeholder="Add a Platform" onSubmit={add} />
      }
    >
      <ul className="games">
        {platforms.map((p) => (
          <li key={p.id} className="row">
            {editing?.id === p.id ? (
              <NameForm value={editing.name} onValueChange={(v) => setEditing({ id: p.id, name: v })} clean={cleanPlatformName}
                maxLength={PLATFORM_NAME_MAX} busy={busy} submitLabel="Save" onSubmit={(clean) => rename(p.id, clean)}
                onCancel={() => setEditing(undefined)} />
            ) : (
              <>
                <span>{p.name}</span>
                <span>
                  <button className="link" disabled={busy} onClick={() => setEditing({ id: p.id, name: p.name })}>Rename</button>
                  <button className="link danger" disabled={busy} onClick={() => remove(p)}>Delete</button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </ListScreen>
  );
}
