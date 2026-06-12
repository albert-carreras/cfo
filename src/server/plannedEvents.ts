import { eq } from "drizzle-orm";
import { z } from "zod";
import { accounts, plannedEvents, properties } from "./db/schema";
import {
  appendMovementTx,
  appendTransferTx,
  intentTransaction,
  recomputeAndPromote,
  type DbTransaction,
} from "./quicklog";
import {
  addPropertySchema,
  addPropertyTx,
  disposePropertyTx,
  ManageInputError,
} from "./manage";
import { setupPlannedEventSchema } from "@/shared/setup";
import { decimalString, isoDate, nonNegativeDecimalString } from "@/shared/validation";

// Planned events are forecasts, not facts: they never move today's net worth
// (only scenarios consume them), so they may be edited freely — until they are
// realised. Realisation is type-specific and NEVER auto-writes ledger rows the
// user didn't explicitly confirm: each kind states exactly the facts/movements
// it creates, they land in one transaction with realisedAt, and any movement
// carries the plannedEventId lineage.

export const plannedEventInputSchema = setupPlannedEventSchema;

export async function createPlannedEvent(input: unknown, now = new Date()) {
  const value = plannedEventInputSchema.parse(input);
  return intentTransaction(async (tx) => {
    const [row] = await tx
      .insert(plannedEvents)
      .values({
        type: value.type,
        date: value.date,
        amount: value.amount,
        probability: value.probability,
        includedInBaseCase: value.includedInBaseCase,
        note: value.note ?? null,
      })
      .returning();
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
    const event = await loadLiveEvent(tx, value.plannedEventId);
    const [row] = await tx
      .update(plannedEvents)
      .set({
        type: value.type,
        date: value.date,
        amount: value.amount,
        probability: value.probability,
        includedInBaseCase: value.includedInBaseCase,
        note: value.note ?? null,
      })
      .where(eq(plannedEvents.id, event.id))
      .returning();
    await recomputeAndPromote(tx, now);
    return row;
  });
}

// One realisation contract per event type — what each kind requires and what
// it writes is part of the schema, not a runtime surprise.
export const realiseInputSchema = z.discriminatedUnion("type", [
  // Money arrives: an explicit, user-confirmed deposit.
  z.object({
    type: z.literal("inheritance"),
    plannedEventId: z.string().min(1),
    accountId: z.string().min(1),
    amount: decimalString,
    occurredAt: isoDate,
    note: z.string().nullish(),
  }),
  // Money leaves the pension wrapper into a cash account: an atomic two-leg
  // transfer (pension withdraw + cash transfer), so the pension is actually
  // drawn down — never a one-sided cash deposit.
  z.object({
    type: z.literal("pension_withdrawal"),
    plannedEventId: z.string().min(1),
    fromAccountId: z.string().min(1),
    toAccountId: z.string().min(1),
    amount: decimalString,
    occurredAt: isoDate,
    note: z.string().nullish(),
  }),
  // A withdrawal pays for it AND the property fact is created.
  z.object({
    type: z.literal("house_purchase"),
    plannedEventId: z.string().min(1),
    accountId: z.string().min(1),
    amount: decimalString,
    occurredAt: isoDate,
    property: addPropertySchema,
    note: z.string().nullish(),
  }),
  // Routes into the property-disposal flow (proceeds + soft-close).
  z.object({
    type: z.literal("property_sale"),
    plannedEventId: z.string().min(1),
    propertyId: z.string().min(1),
    proceedsAccountId: z.string().min(1),
    amount: decimalString,
    occurredAt: isoDate,
    note: z.string().nullish(),
  }),
  // No ledger row — income stopping is an assumption matter, not a movement.
  z.object({
    type: z.literal("job_exit"),
    plannedEventId: z.string().min(1),
  }),
  // The property starts renting: a slow-fact edit, no ledger row.
  z.object({
    type: z.literal("rental_start"),
    plannedEventId: z.string().min(1),
    propertyId: z.string().min(1),
    rentMonthly: nonNegativeDecimalString,
  }),
]);

export type RealiseInput = z.infer<typeof realiseInputSchema>;

async function loadLiveEvent(tx: DbTransaction, id: string) {
  const [event] = await tx
    .select()
    .from(plannedEvents)
    .where(eq(plannedEvents.id, id))
    .limit(1);
  if (!event) {
    throw new ManageInputError("planned event does not exist");
  }
  if (event.realisedAt) {
    throw new ManageInputError("planned event is already realised");
  }
  return event;
}

export async function realisePlannedEvent(input: unknown, now = new Date()) {
  const value = realiseInputSchema.parse(input);
  return intentTransaction(async (tx) => {
    const event = await loadLiveEvent(tx, value.plannedEventId);
    if (event.type !== value.type) {
      throw new ManageInputError(
        `realisation type "${value.type}" does not match the event's type "${event.type}"`,
      );
    }

    switch (value.type) {
      case "inheritance": {
        await appendMovementTx(
          tx,
          {
            type: "deposit",
            accountId: value.accountId,
            amount: value.amount,
            currency: "EUR",
            occurredAt: value.occurredAt,
            note: value.note ?? `Realised planned event: ${event.type}`,
          },
          now,
          { plannedEventId: event.id },
        );
        break;
      }
      case "pension_withdrawal": {
        if (value.fromAccountId === value.toAccountId) {
          throw new ManageInputError(
            "a pension withdrawal needs two different accounts",
          );
        }
        const [from] = await tx
          .select()
          .from(accounts)
          .where(eq(accounts.id, value.fromAccountId))
          .limit(1);
        if (!from || from.disposedAt) {
          throw new ManageInputError("source account does not exist or is closed");
        }
        if (from.type !== "pension") {
          throw new ManageInputError(
            "a pension withdrawal must draw from a pension account",
          );
        }
        await appendTransferTx(
          tx,
          {
            fromAccountId: value.fromAccountId,
            toAccountId: value.toAccountId,
            amount: value.amount,
            occurredAt: value.occurredAt,
            note: value.note ?? `Realised planned event: ${event.type}`,
          },
          now,
          { plannedEventId: event.id },
        );
        break;
      }
      case "house_purchase": {
        await appendMovementTx(
          tx,
          {
            type: "withdraw",
            accountId: value.accountId,
            amount: value.amount,
            currency: "EUR",
            occurredAt: value.occurredAt,
            note: value.note ?? `House purchase — ${value.property.name}`,
          },
          now,
          { plannedEventId: event.id },
        );
        await addPropertyTx(tx, value.property, now);
        break;
      }
      case "property_sale": {
        await disposePropertyTx(
          tx,
          {
            propertyId: value.propertyId,
            proceedsAccountId: value.proceedsAccountId,
            amount: value.amount,
            occurredAt: value.occurredAt,
            note: value.note,
          },
          now,
          { plannedEventId: event.id },
        );
        break;
      }
      case "job_exit": {
        // Nothing moves. The status engine reacts to the spend/runway
        // assumptions — review them after this.
        break;
      }
      case "rental_start": {
        const [property] = await tx
          .select()
          .from(properties)
          .where(eq(properties.id, value.propertyId))
          .limit(1);
        if (!property || property.disposedAt) {
          throw new ManageInputError("property does not exist or is disposed");
        }
        await tx
          .update(properties)
          .set({ rentMonthly: value.rentMonthly })
          .where(eq(properties.id, value.propertyId));
        break;
      }
    }

    const [realised] = await tx
      .update(plannedEvents)
      .set({ realisedAt: now })
      .where(eq(plannedEvents.id, event.id))
      .returning();
    await recomputeAndPromote(tx, now);
    return realised;
  });
}
