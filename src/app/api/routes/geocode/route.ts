import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const member = await verifyMember(request, ["admin", "boss", "user"]);
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
      error_message?: string;
      results?: Array<{
        formatted_address?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
      }>;
    };
    const first = data.results?.[0];
    const location = first?.geometry?.location;
    if (data.status !== "OK" || !location) {
      // Only ZERO_RESULTS means the address is genuinely unknown. Every other
      // status is a configuration or quota problem on our side, and reporting
      // those as "address not found" sends the user off retyping a perfectly
      // valid address while the real cause (API not enabled, key restricted to
      // the wrong API, billing disabled) stays invisible.
      console.error(
        "Geocoding rejected",
        data.status,
        data.error_message ?? "",
      );
      if (data.status === "ZERO_RESULTS")
        return NextResponse.json(
          { error: "Nie znaleziono tego adresu. Sprawdź pisownię ulicy i miasta." },
          { status: 422 },
        );
      if (data.status === "REQUEST_DENIED")
        return NextResponse.json(
          {
            // Google's own error_message distinguishes "API not enabled" from
            // "key has referer restrictions" from "billing disabled" — passing
            // it through turns three guesses into one instruction. It is a
            // diagnostic string from Google; it never contains the key.
            error: `Google odrzucił klucz Maps${
              data.error_message ? `: ${data.error_message}` : ""
            } — sprawdź, czy w projekcie Google Cloud jest włączone Geocoding API, czy klucz nie ma ograniczenia HTTP referrer (to wywołanie idzie z serwera) i czy projekt ma włączone rozliczanie.`,
          },
          { status: 503 },
        );
      if (
        data.status === "OVER_QUERY_LIMIT" ||
        data.status === "OVER_DAILY_LIMIT"
      )
        return NextResponse.json(
          {
            error:
              "Przekroczono limit zapytań Google Maps lub w projekcie nie jest włączone rozliczanie (billing).",
          },
          { status: 503 },
        );
      return NextResponse.json(
        { error: `Usługa map odpowiedziała błędem (${data.status ?? "brak statusu"}).` },
        { status: 502 },
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
