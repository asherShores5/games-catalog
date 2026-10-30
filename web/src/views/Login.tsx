import { useState } from "react";
import { signInWithPassword } from "../auth";

export function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await signInWithPassword(username, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login" onSubmit={submit}>
      <h1>Games Catalog</h1>
      <input autoComplete="username" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
      <input type="password" autoComplete="current-password" placeholder="Password" value={password}
        onChange={(e) => setPassword(e.target.value)} />
      <button className="primary" disabled={busy || !username || !password}>Sign in</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
