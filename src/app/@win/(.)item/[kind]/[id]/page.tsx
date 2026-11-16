import ItemPage from "@/app/item/[kind]/[id]/page";
import { itemKind } from "@/app/routes";
import { SideWindow } from "@/app/SideWindow";

export const dynamic = "force-dynamic";

// Opened from inside the app, an item gets a window of its own.
export default async function Page(props: Parameters<typeof ItemPage>[0]) {
  const { kind, id } = await props.params;
  const { label, icon } = itemKind(kind);
  return (
    <SideWindow route={`/item/${kind}/${id}`} title={label} icon={icon}>
      <ItemPage {...props} />
    </SideWindow>
  );
}
