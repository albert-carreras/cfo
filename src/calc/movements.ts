type CorrectableMovement = {
  id: string;
  occurredAt: string;
  correctsId?: string | null;
};

// One canonical append-only correction rule for every calculator:
// only rows effective by `asOf` may supersede another row.
export function effectiveMovements<T extends CorrectableMovement>(
  movements: T[],
  asOf: string,
): T[] {
  const dated = movements.filter((movement) => movement.occurredAt <= asOf);
  const superseded = new Set(
    dated
      .map((movement) => movement.correctsId)
      .filter((id): id is string => Boolean(id)),
  );

  return dated
    .filter((movement) => !superseded.has(movement.id))
    .sort((a, b) =>
      a.occurredAt < b.occurredAt
        ? -1
        : a.occurredAt > b.occurredAt
          ? 1
          : a.id.localeCompare(b.id),
    );
}
