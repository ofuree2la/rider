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
    avatarPath: profile.avatar_path ?? null,
    driverId: driver ? driver.profile_id : undefined,
    ...(driver
      ? {
          plateNumber: driver.plate_number,
          vehicleType: driver.vehicle_type,
          bankName: driver.bank_name ?? "",
          bankAccountNumber: driver.bank_account_number ?? "",
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
    serviceType: row.service_type ?? "passenger",
    vehicleType: row.vehicle_type ?? "keke",
    deliveryDescription: row.delivery_description ?? null,
    recipientName: row.delivery_recipient_name ?? null,
    recipientPhone: row.delivery_recipient_phone ?? null,
    timing: row.timing,
    scheduledAt: row.scheduled_at,
    status: row.status,
    fare: row.fare,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    paymentReference: row.payment_reference,
    rating: row.rating,
    declinedBy: row.declined_by ?? [],
    cancelledBy: row.cancelled_by ?? null,
    cancellationReason: row.cancellation_reason ?? null,
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
  const driver = data
    ? { ...data, avatarUrl: await getProfilePhotoUrl(data.avatarPath) }
    : null;
  return mapRide(row, driver);
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
    .select("id, full_name, phone, role, avatar_path")
    .eq("id", authUser.id)
    .single();
  throwOnError(error);

  const avatarUrl = await getProfilePhotoUrl(profile.avatar_path);
  if (profile.role !== "driver") {
    return { ...mapProfile(profile, authUser), avatarUrl };
  }

  const { data: driver, error: driverError } = await supabase
    .from("drivers")
    .select("profile_id, plate_number, vehicle_type, bank_name, bank_account_number, rating, status, is_online, subaccount_code")
    .eq("profile_id", authUser.id)
    .single();
  throwOnError(driverError);
  return { ...mapProfile(profile, authUser, driver), avatarUrl };
}

async function getProfilePhotoUrl(path) {
  if (!path) {
    return null;
  }
  const { data, error } = await supabase.storage
    .from("profile-photos")
    .createSignedUrl(path, 60 * 60);
  throwOnError(error);
  return data.signedUrl;
}

export async function uploadProfilePhoto(file) {
  const user = await requireUser();
  const allowedTypes = new Map([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
  ]);
  if (!(file instanceof File) || !allowedTypes.has(file.type)) {
    throw new TypeError("Choose a JPG, PNG, or WebP profile photo.");
  }
  if (file.size === 0 || file.size > 5 * 1024 * 1024) {
    throw new RangeError("Profile photos must be smaller than 5 MB.");
  }

  const { data: currentProfile, error: profileError } = await supabase
    .from("profiles")
    .select("avatar_path")
    .eq("id", user.id)
    .single();
  throwOnError(profileError);

  const photoPath = `${user.id}/${crypto.randomUUID()}.${allowedTypes.get(file.type)}`;
  const { error: uploadError } = await supabase.storage
    .from("profile-photos")
    .upload(photoPath, file, { contentType: file.type, upsert: false });
  throwOnError(uploadError);

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_path: photoPath })
    .eq("id", user.id);
  if (updateError) {
    const { error: cleanupError } = await supabase.storage
      .from("profile-photos")
      .remove([photoPath]);
    if (cleanupError) {
      throw new Error(
        `The photo could not be saved (${updateError.message}); the temporary upload could not be removed (${cleanupError.message}).`,
      );
    }
    throwOnError(updateError);
  }

  let warning = "";
  if (currentProfile.avatar_path) {
    const { error: removeError } = await supabase.storage
      .from("profile-photos")
      .remove([currentProfile.avatar_path]);
    if (removeError) {
      warning = `The new photo was saved, but the previous photo could not be removed: ${removeError.message}`;
    }
  }

  return { user: await getCurrentUser(), warning };
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
  const vehicleType = String(userInput?.vehicleType ?? "");

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
    throw new Error("Enter your vehicle registration or plate number.");
  }
  if (role === "driver" && !["bike", "keke", "minivan"].includes(vehicleType)) {
    throw new Error("Choose a supported vehicle type.");
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: name,
        phone,
        role,
        ...(role === "driver"
          ? { plate_number: plateNumber, vehicle_type: vehicleType }
          : {}),
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
  const bankName = user.role === "driver" ? String(input.bankName ?? "").trim() : "";
  const bankAccountNumber =
    user.role === "driver" ? String(input.bankAccountNumber ?? "").trim() : "";
  if (user.role === "driver" && !plateNumber) {
    throw new Error("Enter your vehicle registration or plate number.");
  }
  if (
    user.role === "driver" &&
    ((bankName && !/^\d{10}$/.test(bankAccountNumber)) ||
      (!bankName && bankAccountNumber) ||
      bankName.length > 120)
  ) {
    throw new Error("Enter a bank name and a valid 10-digit account number, or leave both bank fields blank.");
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
      .update({
        plate_number: plateNumber,
        bank_name: bankName,
        bank_account_number: bankAccountNumber,
      })
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
  await requireUser("admin");
  const { data, error } = await supabase
    .from("drivers")
    .select("profile_id, plate_number, vehicle_type, bank_name, bank_account_number, rating, status, is_online, subaccount_code, created_at, profiles!drivers_profile_id_fkey(full_name, phone, avatar_path)")
    .order("created_at", { ascending: false });
  throwOnError(error);
  return Promise.all(
    (data ?? []).map(async (driver) => ({
      id: driver.profile_id,
      name: driver.profiles?.full_name ?? "Driver",
      phone: driver.profiles?.phone ?? "",
      avatarUrl: await getProfilePhotoUrl(driver.profiles?.avatar_path),
      plateNumber: driver.plate_number,
      vehicleType: driver.vehicle_type,
      bankName: driver.bank_name ?? "",
      bankAccountNumber: driver.bank_account_number ?? "",
      rating: Number(driver.rating),
      status: driver.status,
      verified: driver.status === "approved",
      isOnline: driver.is_online,
      subaccountCode: driver.subaccount_code,
      registeredAt: driver.created_at,
    })),
  );
}

export async function getRegisteredUsers() {
  await requireUser("admin");
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role, avatar_path, created_at")
    .order("created_at", { ascending: false });
  throwOnError(error);
  return Promise.all(
    (data ?? []).map(async (profile) => ({
      id: profile.id,
      name: profile.full_name,
      phone: profile.phone ?? "",
      role: profile.role,
      avatarUrl: await getProfilePhotoUrl(profile.avatar_path),
      registeredAt: profile.created_at,
    })),
  );
}

export async function getAdminAccountDetails(profileId) {
  await requireUser("admin");
  const { data: details, error: detailsError } = await supabase.rpc("admin_get_account_details", {
    target_profile_id: profileId,
  });
  throwOnError(detailsError);
  return {
    ...details,
    avatarUrl: await getProfilePhotoUrl(details.avatarPath),
  };
}

export async function updateAccountAsAdmin(profileId, updates, photoFile = null) {
  await requireUser("admin");
  const name = String(updates?.name ?? "").trim();
  const phone = String(updates?.phone ?? "").trim();
  const plateNumber = updates?.plateNumber == null ? null : String(updates.plateNumber).trim().toUpperCase();
  const bankName = updates?.bankName == null ? null : String(updates.bankName).trim();
  const bankAccountNumber =
    updates?.bankAccountNumber == null ? null : String(updates.bankAccountNumber).trim();

  if (!name || name.length > 120) {
    throw new Error("Enter a name between 1 and 120 characters.");
  }
  if (phone.replace(/\D/g, "").length < 10) {
    throw new Error("Enter a valid phone number, including your country code if needed.");
  }
  if (
    (bankName !== null || bankAccountNumber !== null) &&
    ((bankName && !/^\d{10}$/.test(bankAccountNumber ?? "")) ||
      (!bankName && bankAccountNumber) ||
      (bankName ?? "").length > 120)
  ) {
    throw new Error("Enter a bank name and a valid 10-digit account number, or leave both bank fields blank.");
  }

  const { data: current, error: currentError } = await supabase
    .from("profiles")
    .select("avatar_path")
    .eq("id", profileId)
    .single();
  throwOnError(currentError);

  let newPhotoPath = null;
  if (photoFile) {
    const extensions = new Map([
      ["image/jpeg", "jpg"],
      ["image/png", "png"],
      ["image/webp", "webp"],
    ]);
    const extension = extensions.get(photoFile.type);
    if (!extension || photoFile.size === 0 || photoFile.size > 5 * 1024 * 1024) {
      throw new TypeError("Choose a JPG, PNG, or WebP profile photo up to 5 MB.");
    }
    newPhotoPath = `${profileId}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("profile-photos")
      .upload(newPhotoPath, photoFile, { contentType: photoFile.type, upsert: false });
    throwOnError(uploadError);
  }

  const { error } = await supabase.rpc("admin_update_account_details", {
    target_profile_id: profileId,
    updated_name: name,
    updated_phone: phone,
    updated_plate_number: plateNumber,
    updated_bank_name: bankName,
    updated_bank_account_number: bankAccountNumber,
    updated_avatar_path: newPhotoPath,
  });
  if (error) {
    if (newPhotoPath) {
      const { error: cleanupError } = await supabase.storage
        .from("profile-photos")
        .remove([newPhotoPath]);
      if (cleanupError) {
        throw new Error(
          `The account details could not be saved (${error.message}); the temporary photo could not be removed (${cleanupError.message}).`,
        );
      }
    }
    throwOnError(error);
  }

  if (newPhotoPath && current.avatar_path) {
    const { error: removeError } = await supabase.storage
      .from("profile-photos")
      .remove([current.avatar_path]);
    if (removeError) {
      return "Account details were saved, but the previous profile photo could not be removed.";
    }
  }
  return "";
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
    fareMatrices: data.fare_matrix,
  };
}

export async function updatePricingConfig(config) {
  await requireUser("admin");
  const fareMatrices = {};
  for (const vehicleType of ["keke", "minivan", "bike"]) {
    fareMatrices[vehicleType] = {};
    for (const pickupZone of ZONES) {
      fareMatrices[vehicleType][pickupZone] = {};
      for (const destinationZone of ZONES) {
        const fare = Number(config?.fareMatrices?.[vehicleType]?.[pickupZone]?.[destinationZone]);
        if (!Number.isFinite(fare) || fare < 0 || fare > 100000) {
          throw new Error(
            `Enter a valid ${vehicleType} fare for ${pickupZone} to ${destinationZone}.`,
          );
        }
        fareMatrices[vehicleType][pickupZone][destinationZone] = fare;
      }
    }
  }
  const { data, error } = await supabase
    .from("pricing_settings")
    .update({
      currency: "NGN",
      rounding_increment: 50,
      fare_matrix: fareMatrices,
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
    fareMatrices: data.fare_matrix,
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
  if (filters.createdAfter) {
    query = query.gt("created_at", filters.createdAfter);
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
        ride.vehicle_type === user.vehicleType &&
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
  return Promise.all(
    (data ?? []).map(async (row) => {
      const ride = await mapRideWithDriver(row);
      if (!["accepted", "arriving", "on-trip"].includes(ride.status)) {
        return ride;
      }

      const { data: riderPhone, error: contactError } = await supabase.rpc(
        "get_assigned_ride_rider_phone",
        { target_ride_id: ride.id },
      );
      throwOnError(contactError);
      return { ...ride, riderPhone: riderPhone ?? "" };
    }),
  );
}

export async function getRide(rideId) {
  const { data, error } = await supabase.from("rides").select("*").eq("id", rideId).maybeSingle();
  throwOnError(error);
  return data ? mapRideWithDriver(data) : null;
}

export async function createRide(input) {
  await requireUser("rider");
  const { data, error } = await supabase.rpc("create_ride", {
    selected_service_type: input.serviceType,
    selected_vehicle_type: input.vehicleType,
    pickup_location_id: input.pickup?.id,
    destination_location_id: input.destination?.id,
    passenger_count: Number(input.passengers),
    ride_timing: input.timing,
    pickup_time: input.timing === "scheduled" ? input.scheduledAt : null,
    selected_payment_method: input.paymentMethod,
    package_description: input.deliveryDescription ?? null,
    recipient_full_name: input.recipientName ?? null,
    recipient_contact: input.recipientPhone ?? null,
  });
  throwOnError(error);
  return mapRide(data);
}

export async function getRideMessages(rideId) {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  throwOnError(authError);
  if (!authData.user) {
    throw new Error("Please sign in to view ride messages.");
  }
  const { data, error } = await supabase
    .from("ride_messages")
    .select("id, ride_id, sender_id, body, created_at")
    .eq("ride_id", rideId)
    .order("created_at", { ascending: true });
  throwOnError(error);
  return (data ?? []).map((message) => ({
    id: message.id,
    rideId: message.ride_id,
    senderId: message.sender_id,
    body: message.body,
    createdAt: message.created_at,
  }));
}

export async function sendRideMessage(rideId, body) {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  throwOnError(authError);
  const user = authData.user;
  if (!user) {
    throw new Error("Please sign in to send a ride message.");
  }
  const message = String(body ?? "").trim();
  if (!message || message.length > 1000) {
    throw new TypeError("Messages must be between 1 and 1,000 characters.");
  }
  const { data, error } = await supabase
    .from("ride_messages")
    .insert({ ride_id: rideId, sender_id: user.id, body: message })
    .select("id, ride_id, sender_id, body, created_at")
    .single();
  throwOnError(error);
  return {
    id: data.id,
    rideId: data.ride_id,
    senderId: data.sender_id,
    body: data.body,
    createdAt: data.created_at,
  };
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

function isNetworkFailure(error) {
  const seen = new Set();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (
      current instanceof TypeError ||
      ["AbortError", "FetchError", "FunctionsFetchError"].includes(current.name) ||
      /network|fetch|connection|timed?\s*out|offline/i.test(current.message ?? "")
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

export async function cancelRideRequest(rideId, reason = null) {
  await requireUser("rider");
  const allowedReasons = [
    "found another ride",
    "plans changed",
    "driver too far",
    "booked by mistake",
    "other",
  ];
  if (reason !== null && !allowedReasons.includes(reason)) {
    throw new TypeError("Choose a valid cancellation reason.");
  }

  try {
    const { data, error } = await supabase.rpc("cancel_ride_request", {
      target_ride_id: rideId,
      cancellation_reason: reason,
    });
    throwOnError(error);
    return mapRide(data);
  } catch (error) {
    if (!isNetworkFailure(error)) {
      throw error;
    }

    try {
      const { data, error: refreshError } = await supabase
        .from("rides")
        .select("*")
        .eq("id", rideId)
        .maybeSingle();
      throwOnError(refreshError);
      if (data?.status === "cancelled") {
        return mapRide(data);
      }
    } catch (refreshError) {
      throw new Error("Connection problem, check and try again.", { cause: refreshError });
    }

    throw new Error("Connection problem, check and try again.", { cause: error });
  }
}

export async function cancelScheduledRide(rideId, reason = null) {
  return cancelRideRequest(rideId, reason);
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
