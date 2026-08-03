import "server-only";
import { adminHeaders } from "@/lib/supabase-env";

// Shared by /api/routes/plan (today's active plan) and /api/routes/plan/history
// (past plans) — same shape either way, just a different route_plans row.
export type PlanRow = {
  id: string;
  start_address: string;
  start_latitude: number;
  start_longitude: number;
  optimization_source: string;
  distance_meters: number | null;
  duration_seconds: number | null;
  planned_for?: string;
  status?: string;
  dispatcher_id?: string | null;
  created_at?: string;
};
type StopRow = {
  id: string;
  delivery_order_id: string;
  position: number;
  status: string;
  notes: string;
};
type DeliveryRow = {
  id: string;
  vehicle_id: string;
  customer_id: string;
  address: string;
  latitude: number;
  longitude: number;
  service_minutes: number;
};
type VehicleRow = { id: string; brand: string; model: string; registration_number: string };
type CustomerRow = { id: string; name: string };

export async function loadPlanView(
  url: string,
  secretKey: string,
  organizationId: string,
  plan: PlanRow,
) {
  const headers = adminHeaders(secretKey);
  const stopsResponse = await fetch(
    `${url}/rest/v1/route_stops?select=id,delivery_order_id,position,status,notes&organization_id=eq.${organizationId}&route_plan_id=eq.${plan.id}&order=position.asc`,
    { headers, cache: "no-store" },
  );
  const stops = stopsResponse.ok ? ((await stopsResponse.json()) as StopRow[]) : [];
  const deliveryIds = stops.map((stop) => stop.delivery_order_id);
  const deliveriesResponse = deliveryIds.length
    ? await fetch(
        `${url}/rest/v1/delivery_orders?select=id,vehicle_id,customer_id,address,latitude,longitude,service_minutes&organization_id=eq.${organizationId}&id=in.(${deliveryIds.join(",")})`,
        { headers, cache: "no-store" },
      )
    : null;
  const deliveries = deliveriesResponse?.ok
    ? ((await deliveriesResponse.json()) as DeliveryRow[])
    : [];
  const deliveryById = new Map(deliveries.map((item) => [item.id, item]));
  const vehicleIds = [...new Set(deliveries.map((item) => item.vehicle_id))];
  const customerIds = [...new Set(deliveries.map((item) => item.customer_id))];
  const [vehiclesResponse, customersResponse] = await Promise.all([
    vehicleIds.length
      ? fetch(
          `${url}/rest/v1/vehicles?select=id,brand,model,registration_number&organization_id=eq.${organizationId}&id=in.(${vehicleIds.join(",")})`,
          { headers, cache: "no-store" },
        )
      : null,
    customerIds.length
      ? fetch(
          `${url}/rest/v1/customers?select=id,name&organization_id=eq.${organizationId}&id=in.(${customerIds.join(",")})`,
          { headers, cache: "no-store" },
        )
      : null,
  ]);
  const vehicleById = new Map(
    vehiclesResponse?.ok
      ? ((await vehiclesResponse.json()) as VehicleRow[]).map((item) => [item.id, item])
      : [],
  );
  const customerById = new Map(
    customersResponse?.ok
      ? ((await customersResponse.json()) as CustomerRow[]).map((item) => [item.id, item])
      : [],
  );

  return {
    id: plan.id,
    startAddress: plan.start_address,
    startLatitude: plan.start_latitude,
    startLongitude: plan.start_longitude,
    mode: plan.optimization_source,
    plannedFor: plan.planned_for,
    status: plan.status,
    dispatcherId: plan.dispatcher_id ?? null,
    createdAt: plan.created_at,
    distanceKm: plan.distance_meters ? Math.round(plan.distance_meters / 1000) : 0,
    durationMinutes: plan.duration_seconds ? Math.round(plan.duration_seconds / 60) : 0,
    stops: stops.map((stop) => {
      const delivery = deliveryById.get(stop.delivery_order_id);
      const vehicle = delivery ? vehicleById.get(delivery.vehicle_id) : undefined;
      return {
        stopId: stop.id,
        deliveryId: stop.delivery_order_id,
        status: stop.status,
        notes: stop.notes,
        vehicle: vehicle
          ? `${vehicle.brand} ${vehicle.model} · ${vehicle.registration_number}`
          : "Nieznany pojazd",
        customer: delivery ? customerById.get(delivery.customer_id)?.name ?? "Nieznany klient" : "—",
        address: delivery?.address ?? "",
        latitude: delivery?.latitude ?? 0,
        longitude: delivery?.longitude ?? 0,
        serviceMinutes: delivery?.service_minutes ?? 0,
      };
    }),
  };
}
