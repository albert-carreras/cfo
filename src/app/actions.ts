"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runHealthCheck } from "@/server/healthCheck";

export async function checkNow() {
  await runHealthCheck({ trigger: "manual" });
  revalidatePath("/");
  revalidatePath("/history");
  redirect("/#check");
}
