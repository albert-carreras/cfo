import { SideWindow } from "@/app/SideWindow";
import TaxPage from "@/app/tax/page";

export const dynamic = "force-dynamic";

// Opened from inside the app, Tax gets a window of its own.
export default function Page(props: Parameters<typeof TaxPage>[0]) {
  return (
    <SideWindow route="/tax" title="Tax" icon="calculator">
      <TaxPage {...props} />
    </SideWindow>
  );
}
