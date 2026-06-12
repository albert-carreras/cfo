"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { askQuestion } from "@/server/ask";
import { markReviewed } from "@/server/decisions";

// Mirrors /log's pattern: thin actions over the validated server seams.

export async function submitQuestion(formData: FormData) {
  const result = await askQuestion(formData.get("question"));
  revalidatePath("/ask");
  if (!result.ok) redirect(`/ask?err=${result.reason}`);
  redirect(
    `/ask?d=${result.decisionId}${result.droppedStatements > 0 ? `&dropped=${result.droppedStatements}` : ""}`,
  );
}

export async function submitMarkReviewed(formData: FormData) {
  const id = formData.get("id");
  const chosenAction = formData.get("chosenAction");
  if (typeof id === "string" && id) {
    await markReviewed(
      id,
      typeof chosenAction === "string" && chosenAction.trim()
        ? chosenAction.trim()
        : null,
    );
  }
  revalidatePath("/ask");
  redirect(typeof id === "string" && id ? `/ask?d=${id}` : "/ask");
}
