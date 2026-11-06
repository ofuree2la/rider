import { supabase } from "./supabase-client.js";

const ZONES = ["standard", "campus", "premium-hostel"];

function throwOnError(error) {
  if (error) {
    throw new Error(error.message || "The Rider service request failed.", { cause: error });
  }
}

function mapProfile(profile, authUser, driver = null) {
  return {
    id: profile.id,
    name: profile.full_name,
    email: authUser.email ?? "",
    phone: profile.phone ?? "",
    role: profile.role,
    driverId: driver ? driver.profile_id : undefined,
    ...(driver
      ? {
          plateNumber: driver.plate_number,
          rating: Number(driver.rating),
          status: driver.status,
          verified: driver.status === "approved",
          isOnline: driver.is_online,
          subaccountCode: driver.subaccount_code,
        }
      : {}),
  };
}

async function requireUser(expectedRole) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Please sign in to continue.");
  }
  if (expectedRole && user.role !== expectedRole) {
    throw new Error(`Use a ${expectedRole} account to perform this action.`);
  }
  return user;
}

function mapRide(row, driver = null) {
  return {
    id: row.id,
    userId: row.rider_id,
    driverId: row.driver_id,
    driver,
    pickup: row.pickup,
    destination: row.destination,
    passengers: row.passengers,
    timing: row.timing,
    scheduledAt: row.scheduled_at,
    status: row.status,
    fare: row.fare,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    paymentReference: row.payment_reference,
    rating: row.rating,
    declinedBy: row.declined_by ?? [],
    createdAt: row.created_at,
    matchedAt: row.matched_at,
    arrivedAt: row.arrived_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
  };
}

async function mapRideWithDriver(row) {
  if (!row?.driver_id) {
    return mapRide(row);
  }
  const { data, error } = await supabase.rpc("get_ride_driver", { target_ride_id: row.id });
  throwOnError(error);
  return mapRide(row, data ?? null);
}

export async function getCurrentUser() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  throwOnError(sessionError);
  if (!sessionData.session) {
    return null;
  }
  const { data: authData, error: authError } = await supabase.auth.getUser();
  throwOnError(authError);
  const authUser = authData.user;
  if (!authUser) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role")
    .eq("id", authUser.id)
    .single();
  throwOnError(error);

  if (profile.role !== "driver") {
    return mapProfile(profile, authUser);
  }

  const { data: driver, error: driverError } = await supabase
    .from("drivers")
    .select("profile_id, plate_number, rating, status, is_online, subaccount_code")
    .eq("profile_id", authUser.id)
    .single();
  throwOnError(driverError);
  return mapProfile(profile, authUser, driver);
}

export async function login(email, password, expectedRole) {
  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
    throw new TypeError("Enter your email and password.");
  }
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  throwOnError(error);

  const user = await getCurrentUser();
  if (expectedRole && user.role !== expectedRole) {
    await supabase.auth.signOut();
    throw new Error(`This account is registered as a ${user.role}. Use the ${user.role} sign-in page.`);
  }
  return user;
}

export async function signup(userInput) {
  const name = String(userInput?.name ?? userInput?.fullName ?? "").trim();
  const email = String(userInput?.email ?? "").trim().toLowerCase();
  const password = userInput?.password;
  const role = userInput?.role ?? "rider";
  const phone = String(userInput?.phone ?? "").trim();
  const plateNumber = String(userInput?.plateNumber ?? "").trim().toUpperCase();

  if (!name) {
    throw new Error("Enter your name.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }
  if (!["rider", "driver"].includes(role)) {
    throw new Error("Choose a valid account type.");
  }
  if (phone.replace(/\D/g, "").length < 10) {
    throw new Error("Enter a valid phone number, including your country code if needed.");
  }
  if (role === "driver" && !plateNumber) {
    throw new Error("Enter your keke plate number.");
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: name,
        phone,
        role,
        ...(role === "driver" ? { plate_number: plateNumber } : {}),
      },
      emailRedirectTo: new URL("login.html", window.location.href).href,
    },
  });
  throwOnError(error);

  if (!data.session) {
    return {
      id: data.user?.id,
      email,
      name,
      role,
      confirmationRequired: true,
    };
  }
  return getCurrentUser();
}

export async function logout() {
  const { error } = await supabase.auth.signOut();
  throwOnError(error);
}

export async function updateCurrentUserProfile(input) {
  const user = await requireUser();
  const name = String(input?.name ?? "").trim();
  const phone = String(input?.phone ?? "").trim();
  const requestedEmail = String(input?.email ?? "").trim().toLowerCase();
  if (!name) {
    throw new Error("Enter your name.");
  }
  if (phone.replace(/\D/g, "").length < 10) {
    throw new Error("Enter a valid phone number, including your country code if needed.");
  }
  const plateNumber =
    user.role === "driver" ? String(input.plateNumber ?? "").trim().toUpperCase() : "";
  if (user.role === "driver" && !plateNumber) {
    throw new Error("Enter your keke plate number.");
  }

  if (requestedEmail && requestedEmail !== user.email.toLowerCase()) {
    const { error } = await supabase.auth.updateUser({ email: requestedEmail });
    throwOnError(error);
  }

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: name, phone })
    .eq("id", user.id);
  throwOnError(error);

  if (user.role === "driver") {
    const { error: driverError } = await supabase
      .from("drivers")
      .update({ plate_number: plateNumber })
      .eq("profile_id", user.id);
    throwOnError(driverError);
  }

  return getCurrentUser();
}

export async function getCurrentDriver() {
  const user = await requireUser("driver");
  return user;
}

export async function getDrivers() {
  const { data, error } = await supabase
    .from("drivers")
    .select("profile_id, plate_number, rating, status, is_online, subaccount_code, profiles!drivers_profile_id_fkey(full_name, phone)")
    .order("created_at", { ascending: false });
  throwOnError(error);
  return (data ?? []).map((driver) => ({
    id: driver.profile_id,
    name: driver.profiles?.full_name ?? "Driver",
    phone: driver.profiles?.phone ?? "",
    plateNumber: driver.plate_number,
    rating: Number(driver.rating),
    status: driver.status,
    verified: driver.status === "approved",
    isOnline: driver.is_online,
    subaccountCode: driver.subaccount_code,
  }));
}

export async function setDriverStatus(driverId, status) {
  if (!["approved", "pending", "suspended"].includes(status)) {
    throw new Error("Choose a valid driver account status.");
  }
  const { data, error } = await supabase.rpc("admin_set_driver_status", {
    target_driver_id: driverId,
    next_status: status,
  });
  throwOnError(error);
  return data;
}

export async function isDriverOnline(driverId) {
  const user = await requireUser("driver");
  if (user.id !== driverId) {
    throw new Error("You can only view your own driver availability.");
  }
  return user.status === "approved" && user.isOnline;
}

export async function setDriverOnline(driverId, isOnline) {
  const user = await requireUser("driver");
  if (user.id !== driverId || typeof isOnline !== "boolean") {
    throw new Error("Invalid driver availability request.");
  }
  const { data, error } = await supabase.rpc("set_driver_online", { make_online: isOnline });
  throwOnError(error);
  return data;
}

export async function getLocations() {
  const { data, error } = await supabase
    .from("locations")
    .select("id, name, zone, type")
    .eq("active", true)
    .order("name");
  throwOnError(error);
  return data ?? [];
}

function validateLocation(input) {
  const name = String(input?.name ?? "").trim();
  const zone = String(input?.zone ?? "").trim();
  const type = String(input?.type ?? "building").trim() || "building";
  if (!name) {
    throw new Error("Enter a location name.");
  }
  if (!ZONES.includes(zone)) {
    throw new Error("Choose a valid location zone.");
  }
  return { name, zone, type };
}

export async function createLocation(input) {
  await requireUser("admin");
  const location = validateLocation(input);
  const id = `location-${crypto.randomUUID()}`;
  const { data, error } = await supabase
    .from("locations")
    .insert({ id, ...location })
    .select("id, name, zone, type")
    .single();
  throwOnError(error);
  return data;
}

export async function updateLocation(locationId, input) {
  await requireUser("admin");
  const location = validateLocation(input);
  const { data, error } = await supabase
    .from("locations")
    .update({ ...location, updated_at: new Date().toISOString() })
    .eq("id", locationId)
    .select("id, name, zone, type")
    .single();
  throwOnError(error);
  return data;
}

export async function deleteLocation(locationId) {
  await requireUser("admin");
  const rides = await getRides();
  if (rides.some((ride) => ride.pickup?.id === locationId || ride.destination?.id === locationId)) {
    throw new Error("This location is saved on a ride and cannot be deleted.");
  }
  const { error } = await supabase.from("locations").delete().eq("id", locationId);
  throwOnError(error);
}

export async function getPricingConfig(defaultConfig) {
  const { data, error } = await supabase
    .from("pricing_settings")
    .select("currency, rounding_increment, fare_matrix")
    .eq("id", 1)
    .single();
  throwOnError(error);
  return {
    ...defaultConfig,
    currency: data.currency,
    roundingIncrement: data.rounding_increment,
    fareMatrix: data.fare_matrix,
  };
}

export async function updatePricingConfig(config) {
  await requireUser("admin");
  const fareMatrix = {};
  for (const pickupZone of ZONES) {
    fareMatrix[pickupZone] = {};
    for (const destinationZone of ZONES) {
      const fare = Number(config?.fareMatrix?.[pickupZone]?.[destinationZone]);
      if (!Number.isFinite(fare) || fare < 0 || fare > 100000) {
        throw new Error(`Enter a valid fare for ${pickupZone} to ${destinationZone}.`);
      }
      fareMatrix[pickupZone][destinationZone] = fare;
    }
  }
  const { data, error } = await supabase
    .from("pricing_settings")
    .update({
      currency: "NGN",
      rounding_increment: 50,
      fare_matrix: fareMatrix,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1)
    .select("currency, rounding_increment, fare_matrix")
    .single();
  throwOnError(error);
  return {
    ...config,
    currency: data.currency,
    roundingIncrement: data.rounding_increment,
    fareMatrix: data.fare_matrix,
  };
}

export async function getRides(filters = {}) {
  let query = supabase.from("rides").select("*").order("created_at", { ascending: false });
  if (filters.userId) {
    query = query.eq("rider_id", filters.userId);
  }
  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  const { data, error } = await query;
  throwOnError(error);
  return Promise.all((data ?? []).map(mapRideWithDriver));
}

export async function getDriverRideRequests(driverId) {
  const user = await requireUser("driver");
  if (user.id !== driverId || user.status !== "approved" || !user.isOnline) {
    return [];
  }
  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("status", "finding")
    .order("created_at", { ascending: true });
  throwOnError(error);
  return (data ?? [])
    .filter(
      (ride) =>
        !(ride.declined_by ?? []).includes(driverId) &&
        (ride.payment_method !== "online" || user.subaccountCode),
    )
    .map(mapRide);
}

export async function getDriverRides(driverId) {
  const user = await requireUser("driver");
  if (user.id !== driverId) {
    throw new Error("You can only view your own assigned rides.");
  }
  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false });
  throwOnError(error);
  return Promise.all((data ?? []).map(mapRideWithDriver));
}

export async function getRide(rideId) {
  const { data, error } = await supabase.from("rides").select("*").eq("id", rideId).maybeSingle();
  throwOnError(error);
  return data ? mapRideWithDriver(data) : null;
}

export async function createRide(input) {
  await requireUser("rider");
  const { data, error } = await supabase.rpc("create_ride", {
    pickup_location_id: input.pickup?.id,
    destination_location_id: input.destination?.id,
    passenger_count: Number(input.passengers),
    ride_timing: input.timing,
    pickup_time: input.timing === "scheduled" ? input.scheduledAt : null,
    selected_payment_method: input.paymentMethod,
  });
  throwOnError(error);
  return mapRide(data);
}

export async function acceptRideRequest(rideId, driverId) {
  const user = await requireUser("driver");
  if (user.id !== driverId) {
    throw new Error("Sign in as the selected driver to accept this request.");
  }
  const { data, error } = await supabase.rpc("accept_ride_request", {
    target_ride_id: rideId,
  });
  throwOnError(error);
  return mapRide(data, user);
}

export async function declineRideRequest(rideId, driverId) {
  const user = await requireUser("driver");
  if (user.id !== driverId) {
    throw new Error("Sign in as the selected driver to decline this request.");
  }
  const { error } = await supabase.rpc("decline_ride_request", {
    target_ride_id: rideId,
  });
  throwOnError(error);
}

export async function updateDriverRideStatus(rideId, driverId, nextStatus) {
  const user = await requireUser("driver");
  if (user.id !== driverId) {
    throw new Error("Sign in as the assigned driver to update this ride.");
  }
  const { data, error } = await supabase.rpc("advance_driver_ride", {
    target_ride_id: rideId,
    next_status: nextStatus,
  });
  throwOnError(error);
  return mapRide(data, user);
}

export async function cancelScheduledRide(rideId) {
  const { data, error } = await supabase.rpc("cancel_scheduled_ride", {
    target_ride_id: rideId,
  });
  throwOnError(error);
  return mapRide(data);
}

export async function rateRide(rideId, rating, comment = "") {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new RangeError("Choose a rating from 1 to 5 stars.");
  }
  if (typeof comment !== "string" || comment.length > 500) {
    throw new TypeError("Comments must be 500 characters or fewer.");
  }
  const { data, error } = await supabase.rpc("rate_ride", {
    target_ride_id: rideId,
    star_rating: rating,
    rating_comment: comment.trim(),
  });
  throwOnError(error);
  return mapRide(data);
}

export async function updateRide(rideId, updates) {
  const ride = await getRide(rideId);
  if (!ride) {
    throw new Error("This ride could not be found.");
  }
  if (updates.paymentStatus || updates.paymentReference) {
    throw new Error("Payment updates must be confirmed by the secure payment server.");
  }
  if (updates.rating) {
    return rateRide(rideId, updates.rating.stars, updates.rating.comment ?? "");
  }
  if (updates.status && updates.status !== ride.status) {
    const nextStatus = updates.status;
    if (ride.status === "accepted" && nextStatus === "arriving") {
      return updateDriverRideStatus(rideId, ride.driverId, "arriving");
    }
    if (ride.status === "arriving" && nextStatus === "on-trip") {
      return updateDriverRideStatus(rideId, ride.driverId, "on-trip");
    }
    if (ride.status === "on-trip" && nextStatus === "completed") {
      return updateDriverRideStatus(rideId, ride.driverId, "completed");
    }
  }
  throw new Error("This ride update is not supported.");
}
