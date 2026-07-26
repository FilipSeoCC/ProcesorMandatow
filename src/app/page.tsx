import type { Metadata } from "next";
import MandatyWorkspace from "./workspace";
import AuthGate from "./auth-gate";

export const metadata: Metadata = {
  title: "Panel obsługi mandatów — PoC",
  description:
    "Interaktywny prototyp procesu skanowania i obsługi korespondencji mandatowej.",
  robots: { index: false, follow: false },
};

export default function MandatyDemoPage() {
  return (
    <AuthGate>
      <MandatyWorkspace />
    </AuthGate>
  );
}
