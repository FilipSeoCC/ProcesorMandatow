// Shared by delivery-planner.tsx (dispatcher's own drive) and mobile-route.tsx
// (field employee's "Moja trasa na dziś") — same Google Maps deep-link logic
// either way.

type NavigableStop = { address: string; latitude: number; longitude: number };

// Navigate to the address, not to raw coordinates. Google reverse-geocodes a
// bare lat/lng to the nearest named place, so the driver was shown things
// like a school instead of "Postępu 14" and could not tell whether the pin
// was right. The address here is Google's own formatted_address from the
// geocoding step, so it resolves back to the same point.
function mapsPoint(stop: NavigableStop) {
  return stop.address?.trim() || `${stop.latitude},${stop.longitude}`;
}

// Google's URL API accepts at most 9 intermediate waypoints; beyond that it
// silently drops the tail, so we hand over one batch and the driver reopens
// the link once those are done.
const WAYPOINT_LIMIT = 9;

// One navigation link covering everything still to deliver, in the order the
// route was optimized — sending only the next stop would throw away the
// whole point of planning the route.
export function buildNavigation(remainingStops: NavigableStop[]) {
  if (!remainingStops.length) return { url: "", label: "Nawiguj do klienta" };
  const capped = remainingStops.slice(0, WAYPOINT_LIMIT + 1);
  const destination = mapsPoint(capped[capped.length - 1]);
  const waypoints = capped.slice(0, -1).map(mapsPoint);
  const base = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    destination,
  )}&travelmode=driving`;
  const url = waypoints.length
    ? `${base}&waypoints=${encodeURIComponent(waypoints.join("|"))}`
    : `${base}&dir_action=navigate`;
  const label =
    remainingStops.length > 1
      ? `Nawiguj całą trasą (${Math.min(remainingStops.length, WAYPOINT_LIMIT + 1)})`
      : "Nawiguj do klienta";
  return { url, label };
}
