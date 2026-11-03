// Guest demo: lets a visitor browse a sample library without an account (see GLOSSARY.md: Demo).
// Demo mode is per tab (sessionStorage), entered from the Login page or a ?demo link. While it is
// on, api.ts answers from demoData.ts and never calls the real API, so a demo can't read or
// change real data and costs nothing.

const KEY = "games.demo";
const listeners = new Set<() => void>();

let on = readStored() || new URLSearchParams(location.search).has("demo");
if (on) store(true);

function readStored() {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function store(value: boolean) {
  try {
    if (value) sessionStorage.setItem(KEY, "1");
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked: demo mode still works for this page load.
  }
}

function setDemo(value: boolean) {
  on = value;
  store(value);
  for (const fn of listeners) fn();
}

export const isDemo = () => on;
export const enterDemo = () => setDemo(true);
export const exitDemo = () => setDemo(false);

export function onDemoChange(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
