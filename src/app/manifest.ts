import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FlotaFlow — Mandaty i dostawy",
    short_name: "FlotaFlow",
    description:
      "Mobilne skanowanie dokumentów i planowanie dostaw samochodów.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f7fb",
    theme_color: "#172033",
    orientation: "any",
  };
}
