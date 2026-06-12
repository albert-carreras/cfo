// One-off assumption upsert — the non-destructive entry path for assumption
// rows on a live database (the seed wipes everything; never run it on prod).
// Thin CLI wrapper over src/server/assumptions.ts (the /manage form's path).
//
//   npx tsx scripts/set-assumption.ts --key birthDate --date 1985-04-09
//   npx tsx scripts/set-assumption.ts --key safeWithdrawalRate --value 0.035 --source "rule of thumb"
//
// On the prod host (runs inside the jobs image, which keeps tsx):
//   docker compose -f docker-compose.server.yml run --rm app_setup \
//     npx tsx scripts/set-assumption.ts --key birthDate --date 1985-04-09

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  try {
    process.loadEnvFile();
  } catch {
    // no .env file — rely on the ambient environment
  }
  const { setAssumption } = await import("../src/server/assumptions");

  const key = arg("key");
  const value = arg("value");
  const dateValue = arg("date");

  if (!key || (value === null) === (dateValue === null)) {
    console.error(
      "Usage: tsx scripts/set-assumption.ts --key <key> (--value <number> | --date <YYYY-MM-DD>) [--source <text>] [--reviewed <YYYY-MM-DD>]",
    );
    process.exit(1);
  }

  const row = await setAssumption({
    key,
    value,
    dateValue,
    source: arg("source") ?? "user",
    lastReviewedAt: arg("reviewed") ?? undefined,
  });

  console.log(
    `Assumption "${row.key}" = ${row.value ?? row.dateValue} (source: ${row.source}, reviewed: ${row.lastReviewedAt}, id: ${row.id})`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
