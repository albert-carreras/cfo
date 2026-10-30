import { z } from "zod";

const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DATABASE_URL: z.string().min(1),
  // ntfy push topic URL (e.g. https://ntfy.sh/<topic>). Optional: absent ⇒
  // notifications are a no-op. Public-topic discipline: coarse payloads only.
  NTFY_URL: z.string().url().optional(),
  // Where the app is reachable; the monthly push opens it when tapped.
  CFO_PUBLIC_URL: z.string().url().optional().catch(undefined),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(input: NodeJS.ProcessEnv): ServerEnv {
  return serverEnvSchema.parse(input);
}

export function getServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}
