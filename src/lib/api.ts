import { toast } from 'sonner';
import type { ActionInput, ActionName, ActionResult } from '@shared/actions';

// Actions with an empty body (zod infers Record<string, never>) take no argument.
type Args<K extends ActionName> = string extends keyof ActionInput<K> ? [] : [input: ActionInput<K>];

/** Runs a panel action on the server. Failures show a toast and resolve to null. */
export async function act<K extends ActionName>(name: K, ...[input]: Args<K>): Promise<{ result: ActionResult<K> } | null> {
  navigator.vibrate?.(10);
  try {
    const res = await fetch(`/api/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input ?? {}),
    });
    const data = (await res.json()) as { result: ActionResult<K>; error?: string };
    if (!res.ok) throw new Error(data.error ?? 'Fehler');
    return data;
  } catch (e) {
    toast.error(e instanceof TypeError ? 'Regie-Server nicht erreichbar' : (e as Error).message);
    return null;
  }
}
