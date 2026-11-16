import { SideWindow } from "@/app/SideWindow";
import PlansPage from "@/app/plans/page";

export const dynamic = "force-dynamic";

// Opened from inside the app, Plans gets a window of its own.
export default function Page(props: Parameters<typeof PlansPage>[0]) {
  return (
    <SideWindow route="/plans" title="Plans" icon="scheduled-tasks">
      <PlansPage {...props} />
    </SideWindow>
  );
}
