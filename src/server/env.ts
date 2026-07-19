import { z } from "zod";

const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  // The brain's only secret. No third-party tokens in the manual-entry core.
  DATABASE_URL: z.string().min(1),
  // Optional monthly qualitative check. Without it, the deterministic check
  // and the rest of the product continue without provider prose.
  OPENAI_API_KEY: z.string().min(1).optional(),
  // Optional provider-model override; absent uses src/ai/check.ts's default.
  OPENAI_MODEL: z.string().min(1).optional(),
  // ntfy push topic URL (e.g. https://ntfy.sh/<topic>). Optional: absent ⇒
  // notifications are a no-op. Public-topic discipline: coarse payloads only.
  NTFY_URL: z.string().url().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(input: NodeJS.ProcessEnv): ServerEnv {
  return serverEnvSchema.parse(input);
}

export function getServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}
