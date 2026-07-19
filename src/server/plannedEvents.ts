import { eq } from "drizzle-orm";
import { z } from "zod";
import { setupPlannedEventSchema } from "@/shared/setup";
import { plannedEvents } from "./db/schema";
import { ManageInputError } from "./manage";
import {
  intentTransaction,
  recomputeAndPromote,
  type DbTransaction,
} from "./quicklog";

// Plans are context, not simulated facts. When a plan happens, the user first
// updates the real assets/debts in Data and then marks the plan reflected.

export const plannedEventInputSchema = setupPlannedEventSchema;

async function loadOpenEvent(tx: DbTransaction, id: string) {
  const [event] = await tx
    .select()
    .from(plannedEvents)
    .where(eq(plannedEvents.id, id))
    .limit(1);
  if (!event) throw new ManageInputError("planned event does not exist");
  if (event.realisedAt) throw new ManageInputError("planned event is already reflected");
  return event;
}

export async function createPlannedEvent(input: unknown, now = new Date()) {
  const value = plannedEventInputSchema.parse(input);
  return intentTransaction(async (tx) => {
    const [row] = await tx.insert(plannedEvents).values({
      type: value.type,
      date: value.date,
      amount: value.amount,
      probability: value.probability,
      includedInBaseCase: value.includedInBaseCase,
      note: value.note ?? null,
    }).returning();
    await recomputeAndPromote(tx, now);
    return row;
  });
}

export const updatePlannedEventSchema = plannedEventInputSchema.extend({
  plannedEventId: z.string().min(1),
});

export async function updatePlannedEvent(input: unknown, now = new Date()) {
  const value = updatePlannedEventSchema.parse(input);
  return intentTransaction(async (tx) => {
    const event = await loadOpenEvent(tx, value.plannedEventId);
    const [row] = await tx.update(plannedEvents).set({
      type: value.type,
      date: value.date,
      amount: value.amount,
      probability: value.probability,
      includedInBaseCase: value.includedInBaseCase,
      note: value.note ?? null,
    }).where(eq(plannedEvents.id, event.id)).returning();
    await recomputeAndPromote(tx, now);
    return row;
  });
}

export async function completePlannedEvent(id: string, now = new Date()) {
  return intentTransaction(async (tx) => {
    const event = await loadOpenEvent(tx, id);
    const [row] = await tx
      .update(plannedEvents)
      .set({ realisedAt: now })
      .where(eq(plannedEvents.id, event.id))
      .returning();
    await recomputeAndPromote(tx, now);
    return row;
  });
}
