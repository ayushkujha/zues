// localStorage can throw (private mode, blocked storage): every access is guarded.
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`pcast.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(`pcast.${key}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
