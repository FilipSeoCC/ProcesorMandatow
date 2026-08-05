import type { Metadata } from "next";
import AuthGate from "../auth-gate";
import MobileRoute from "../mobile-route";

export const metadata: Metadata = {
  title: "Moja trasa — FlotaFlow",
  description: "Zadania dnia dla pracownika w terenie.",
  robots: { index: false, follow: false },
};

export default function MobilePage() {
  return (
    <AuthGate>
      <MobileRoute />
    </AuthGate>
  );
}
