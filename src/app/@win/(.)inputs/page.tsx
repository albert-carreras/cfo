import { SideWindow } from "@/app/SideWindow";
import InputsPage from "@/app/inputs/page";

export const dynamic = "force-dynamic";

// Opened from inside the app, Inputs gets a window of its own.
export default function Page(props: Parameters<typeof InputsPage>[0]) {
  return (
    <SideWindow route="/inputs" title="Inputs" icon="control-panel">
      <InputsPage {...props} />
    </SideWindow>
  );
}
