import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const member = await verifyMember(request, ["admin", "dispatcher"]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const address =
    typeof body?.address === "string" ? body.address.trim() : "";
  if (!address || address.length > 300)
    return NextResponse.json({ error: "Podaj poprawny adres." }, {
      status: 422,
    });

  const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!apiKey)
    return NextResponse.json(
      {
        error:
          "Wyszukiwanie adresów nie jest skonfigurowane — brakuje klucza Google Maps (GOOGLE_MAPS_SERVER_API_KEY). Zgłoś to administratorowi; planer tras nie zadziała bez niego.",
      },
      { status: 503 },
    );

  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=pl&key=${apiKey}`,
      { signal: AbortSignal.timeout(10_000), cache: "no-store" },
    );
    const data = (await response.json()) as {
      status?: string;
      results?: Array<{
        formatted_address?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
      }>;
    };
    const first = data.results?.[0];
    const location = first?.geometry?.location;
    if (data.status !== "OK" || !location) {
      return NextResponse.json(
        { error: "Nie znaleziono tego adresu." },
        { status: 422 },
      );
    }
    return NextResponse.json({
      latitude: location.lat,
      longitude: location.lng,
      formattedAddress: first?.formatted_address ?? address,
    });
  } catch (error) {
    console.error("Geocoding failed", error);
    return NextResponse.json(
      { error: "Usługa map jest chwilowo niedostępna." },
      { status: 502 },
    );
  }
}
