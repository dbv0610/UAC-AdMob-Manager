import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { apps } from '../db/schema';
import type { AppMapping } from '@shared/types';

export function listApps(): AppMapping[] {
  return db.select().from(apps).orderBy(apps.name).all();
}

export function saveApp(input: Omit<AppMapping, 'id'> & { id?: string }): AppMapping {
  const row = { ...input, id: input.id ?? randomUUID() };
  return db.insert(apps).values(row).onConflictDoUpdate({ target: apps.id, set: row }).returning().get();
}

export function removeApp(id: string) {
  db.delete(apps).where(eq(apps.id, id)).run();
}
