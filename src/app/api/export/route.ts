import { buildContextPack } from "@/server/contextPack";

export const dynamic = "force-dynamic";

export async function GET() {
  const markdown = await buildContextPack();
  const date = new Date().toISOString().slice(0, 10);
  return new Response(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="cfo-context-${date}.md"`,
      "cache-control": "no-store",
    },
  });
}
