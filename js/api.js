import { locations, mockDrivers, starterUsers } from "./mockData.js?v=seats4";

const STORAGE_KEYS = Object.freeze({
  users: "rider.users",
  session: "rider.session",
  rides: "rider.rides",
  drivers: "rider.drivers",
  onlineDrivers: "rider.onlineDrivers",
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getStorage() {
  if (typeof localStorage === "undefined") {
    throw new Error("Rider storage is unavailable in this browser.");
  }

  return localStorage;
}

function readStoredValue(key, initialValue) {
  const storage = getStorage();
  const serializedValue = storage.getItem(key);

  if (serializedValue === null) {
    writeStoredValue(key, initialValue);
    return clone(initialValue);
  }

  try {
    return JSON.parse(serializedValue);
  } catch (error) {
    throw new Error(`Saved Rider data for "${key}" is invalid JSON.`, { cause: error });
  }
}

function readCollection(key, initialValue = []) {
  const value = readStoredValue(key, initialValue);
  if (!Array.isArray(value)) {
    throw new Error(`Saved Rider data for "${key}" must be a list.`);
  }

  return value;
}

function writeStoredValue(key, value) {
  getStorage().setItem(key, JSON.stringify(value));
}

function getUsers() {
  const storedUsers = readCollection(STORAGE_KEYS.users, starterUsers);
  const users = storedUsers.map((user) =>
    user.role === "student" ? { ...user, role: "rider" } : user,
  );

  if (users.some((user, index) => user !== storedUsers[index])) {
    writeStoredValue(STORAGE_KEYS.users, users);
  }

  return users;
}

function getRidesFromStorage() {
  return readCollection(STORAGE_KEYS.rides);
}

function findLocation(locationValue) {
  if (typeof locationValue === "object" && locationValue !== null) {
    return locations.find(
      (location) =>
        location.id === locationValue.id ||
        (location.name === locationValue.name && location.zone === locationValue.zone),
    );
  }

  return locations.find(
    (location) => location.id === locationValue || location.name === locationValue,
  );
}

function makeId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toPublicUser(user) {
  const { password, ...publicUser } = user;
  return clone(publicUser);
}

export function getLocations() {
  return clone(locations);
}

export function getDrivers() {
  return readCollection(STORAGE_KEYS.drivers, mockDrivers).map(clone);
}

function findDriver(driverId) {
  const driver = getDrivers().find((candidate) => candidate.id === driverId);
  if (!driver) {
    throw new Error("Choose a valid driver profile.");
  }
  return driver;
}

export function getCurrentDriver() {
  const user = getCurrentUser();
  if (!user || user.role !== "driver" || !user.driverId) {
    throw new Error("Sign in with a Rider Driver account to open the driver dashboard.");
  }
  return clone(findDriver(user.driverId));
}

export function isDriverOnline(driverId) {
  findDriver(driverId);
  return readCollection(STORAGE_KEYS.onlineDrivers).includes(driverId);
}

export function setDriverOnline(driverId, isOnline) {
  findDriver(driverId);
  if (typeof isOnline !== "boolean") {
    throw new TypeError("Driver availability must be online or offline.");
  }

  const onlineDriverIds = readCollection(STORAGE_KEYS.onlineDrivers);
  const nextOnlineDriverIds = isOnline
    ? [...new Set([...onlineDriverIds, driverId])]
    : onlineDriverIds.filter((onlineId) => onlineId !== driverId);
  writeStoredValue(STORAGE_KEYS.onlineDrivers, nextOnlineDriverIds);
  return isOnline;
}

export function getRides(filters = {}) {
  const rides = getRidesFromStorage();

  return rides
    .filter((ride) => !filters.userId || ride.userId === filters.userId)
    .filter((ride) => !filters.status || ride.status === filters.status)
    .map(clone);
}

export function getDriverRideRequests(driverId) {
  findDriver(driverId);
  return getRidesFromStorage()
    .filter((ride) => ride.status === "finding")
    .filter((ride) => !ride.declinedBy?.includes(driverId))
    .map(clone);
}

export function getDriverRides(driverId) {
  findDriver(driverId);
  return getRidesFromStorage()
    .filter((ride) => ride.driver?.id === driverId)
    .map(clone);
}

export function getRide(rideId) {
  if (typeof rideId !== "string" || !rideId.trim()) {
    throw new TypeError("A ride ID is required.");
  }

  const ride = getRidesFromStorage().find((candidate) => candidate.id === rideId);
  return ride ? clone(ride) : null;
}

export function createRide(rideInput) {
  if (!rideInput || typeof rideInput !== "object") {
    throw new TypeError("Ride details are required.");
  }

  // Booking is available as a guest until the authentication step adds the UI login gate.
  const currentUser = getCurrentUser();

  const pickup = findLocation(rideInput.pickup);
  const destination = findLocation(rideInput.destination);

  if (!pickup || !destination) {
    throw new Error("Choose a pickup and destination from the available locations.");
  }
  if (pickup.id === destination.id) {
    throw new Error("Pickup and destination must be different locations.");
  }

  const passengers = Number(rideInput.passengers ?? 1);
  if (!Number.isInteger(passengers) || passengers < 1 || passengers > 4) {
    throw new RangeError("Passenger count must be between 1 and 4.");
  }

  const rides = getRidesFromStorage();
  const ride = {
    ...clone(rideInput),
    id: makeId("ride"),
    userId: currentUser?.id ?? null,
    pickup: clone(pickup),
    destination: clone(destination),
    passengers,
    status: "finding",
    createdAt: new Date().toISOString(),
  };

  rides.push(ride);
  writeStoredValue(STORAGE_KEYS.rides, rides);
  return clone(ride);
}

export function updateRide(rideId, updates) {
  if (typeof rideId !== "string" || !rideId) {
    throw new TypeError("A ride ID is required.");
  }
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    throw new TypeError("Ride updates must be provided as an object.");
  }

  const rides = getRidesFromStorage();
  const rideIndex = rides.findIndex((ride) => ride.id === rideId);
  if (rideIndex === -1) {
    throw new Error(`Ride "${rideId}" was not found.`);
  }

  const { id, userId, createdAt, ...allowedUpdates } = updates;
  rides[rideIndex] = { ...rides[rideIndex], ...clone(allowedUpdates) };
  writeStoredValue(STORAGE_KEYS.rides, rides);
  return clone(rides[rideIndex]);
}

export function acceptRideRequest(rideId, driverId) {
  const driver = findDriver(driverId);
  if (!driver.verified) {
    throw new Error("Only verified drivers can accept ride requests.");
  }
  if (!isDriverOnline(driverId)) {
    throw new Error("Go online before accepting a ride request.");
  }

  const ride = getRide(rideId);
  if (!ride) {
    throw new Error("This ride request could not be found.");
  }
  if (ride.status !== "finding" || ride.driver) {
    throw new Error("This ride request has already been accepted or closed.");
  }

  return updateRide(rideId, {
    status: "accepted",
    driver: clone(driver),
    matchedAt: new Date().toISOString(),
    declinedBy: [],
  });
}

export function declineRideRequest(rideId, driverId) {
  findDriver(driverId);
  const ride = getRide(rideId);
  if (!ride) {
    throw new Error("This ride request could not be found.");
  }
  if (ride.status !== "finding" || ride.driver) {
    throw new Error("This ride request has already been accepted or closed.");
  }

  const declinedBy = [...new Set([...(ride.declinedBy ?? []), driverId])];
  return updateRide(rideId, { declinedBy });
}

export function updateDriverRideStatus(rideId, driverId, nextStatus) {
  findDriver(driverId);
  const ride = getRide(rideId);
  if (!ride) {
    throw new Error("This ride could not be found.");
  }
  if (ride.driver?.id !== driverId) {
    throw new Error("This ride is not assigned to the selected driver.");
  }

  const transitions = {
    accepted: { next: "arriving", timestamp: "arrivedAt" },
    arriving: { next: "on-trip", timestamp: "startedAt" },
    "on-trip": { next: "completed", timestamp: "completedAt" },
  };
  const transition = transitions[ride.status];
  if (!transition || nextStatus !== transition.next) {
    throw new Error("That ride status update is not allowed.");
  }

  return updateRide(rideId, {
    status: nextStatus,
    [transition.timestamp]: new Date().toISOString(),
  });
}

export function cancelScheduledRide(rideId) {
  const ride = getRide(rideId);
  if (!ride) {
    throw new Error("This ride could not be found.");
  }
  if (ride.timing !== "scheduled") {
    throw new Error("Only scheduled rides can be cancelled from ride history.");
  }
  if (["completed", "cancelled", "on-trip"].includes(ride.status)) {
    throw new Error("This ride can no longer be cancelled.");
  }
  const scheduledAt = new Date(ride.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new Error("This ride has an invalid scheduled pickup time.");
  }
  if (scheduledAt <= new Date()) {
    throw new Error("This scheduled ride is no longer eligible for cancellation.");
  }

  return updateRide(rideId, {
    status: "cancelled",
    cancelledAt: new Date().toISOString(),
  });
}

export function rateRide(rideId, rating, comment = "") {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new RangeError("Choose a rating from 1 to 5 stars.");
  }
  if (typeof comment !== "string" || comment.length > 500) {
    throw new TypeError("Comments must be 500 characters or fewer.");
  }

  const ride = getRide(rideId);
  if (!ride) {
    throw new Error("This ride could not be found.");
  }
  if (ride.status !== "completed") {
    throw new Error("You can rate a ride after it is completed.");
  }
  if (ride.rating) {
    throw new Error("This ride has already been rated.");
  }

  return updateRide(rideId, {
    rating: {
      stars: rating,
      comment: comment.trim(),
      submittedAt: new Date().toISOString(),
    },
  });
}

export function login(email, password, expectedRole) {
  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
    throw new TypeError("Enter your email and password.");
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = getUsers().find((candidate) => candidate.email.toLowerCase() === normalizedEmail);

  if (!user || user.password !== password) {
    throw new Error("Email or password is incorrect.");
  }
  if (expectedRole && user.role !== expectedRole) {
    throw new Error(
      `This account is registered as a ${user.role}. Use the ${user.role} sign-in page.`,
    );
  }

  writeStoredValue(STORAGE_KEYS.session, {
    userId: user.id,
    createdAt: new Date().toISOString(),
  });
  return toPublicUser(user);
}

export function signup(userInput) {
  if (!userInput || typeof userInput !== "object") {
    throw new TypeError("Signup details are required.");
  }

  const name = String(userInput.name ?? userInput.fullName ?? "").trim();
  const email = String(userInput.email ?? "").trim().toLowerCase();
  const password = userInput.password;
  const role = userInput.role ?? "rider";

  if (!name) {
    throw new Error("Enter your name.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }
  if (role !== "rider" && role !== "driver") {
    throw new Error("Choose a valid account type.");
  }

  const users = getUsers();
  if (users.some((user) => user.email.toLowerCase() === email)) {
    throw new Error("An account with this email already exists.");
  }

  let driverProfile = null;
  if (role === "driver") {
    const phone = String(userInput.phone ?? "").trim();
    const plateNumber = String(userInput.plateNumber ?? "").trim().toUpperCase();
    const phoneDigits = phone.replace(/\D/g, "");

    if (phoneDigits.length < 10 || phoneDigits.length > 15) {
      throw new Error("Enter a valid phone number, including your country code if needed.");
    }
    if (!plateNumber) {
      throw new Error("Enter your keke plate number.");
    }

    const drivers = readCollection(STORAGE_KEYS.drivers, mockDrivers);
    if (drivers.some((driver) => driver.plateNumber?.toLowerCase() === plateNumber.toLowerCase())) {
      throw new Error("A driver account with this plate number already exists.");
    }

    driverProfile = {
      id: makeId("driver"),
      name,
      plateNumber,
      phone,
      rating: 5,
      verified: true,
      demoAccount: true,
    };
  }

  const user = {
    ...clone(userInput),
    id: makeId("user"),
    name,
    email,
    role,
    ...(driverProfile ? { driverId: driverProfile.id } : {}),
    createdAt: new Date().toISOString(),
  };

  if (driverProfile) {
    const drivers = readCollection(STORAGE_KEYS.drivers, mockDrivers);
    drivers.push(driverProfile);
    writeStoredValue(STORAGE_KEYS.drivers, drivers);
  }

  users.push(user);
  writeStoredValue(STORAGE_KEYS.users, users);
  writeStoredValue(STORAGE_KEYS.session, {
    userId: user.id,
    createdAt: new Date().toISOString(),
  });

  return toPublicUser(user);
}

export function updateCurrentUserProfile(profileInput) {
  if (!profileInput || typeof profileInput !== "object" || Array.isArray(profileInput)) {
    throw new TypeError("Profile details must be provided.");
  }

  const currentUser = getCurrentUser();
  if (!currentUser) {
    throw new Error("Sign in to update your profile.");
  }

  const users = getUsers();
  const userIndex = users.findIndex((user) => user.id === currentUser.id);
  if (userIndex === -1) {
    throw new Error("Your account could not be found. Sign in again.");
  }

  const name = String(profileInput.name ?? "").trim();
  const email = String(profileInput.email ?? "").trim().toLowerCase();
  const phone = String(profileInput.phone ?? "").trim();
  const phoneDigits = phone.replace(/\D/g, "");

  if (!name) {
    throw new Error("Enter your name.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  if (users.some((user, index) => index !== userIndex && user.email.toLowerCase() === email)) {
    throw new Error("Another account already uses this email address.");
  }
  if (phoneDigits.length < 10 || phoneDigits.length > 15) {
    throw new Error("Enter a valid phone number, including your country code if needed.");
  }

  let drivers;
  let driverIndex = -1;
  let plateNumber;
  if (currentUser.role === "driver") {
    plateNumber = String(profileInput.plateNumber ?? "").trim().toUpperCase();
    if (!plateNumber) {
      throw new Error("Enter your keke plate number.");
    }

    drivers = readCollection(STORAGE_KEYS.drivers, mockDrivers);
    driverIndex = drivers.findIndex((driver) => driver.id === currentUser.driverId);
    if (driverIndex === -1) {
      throw new Error("Your driver profile could not be found.");
    }
    if (
      drivers.some(
        (driver, index) =>
          index !== driverIndex && driver.plateNumber?.toLowerCase() === plateNumber.toLowerCase(),
      )
    ) {
      throw new Error("Another driver already uses this plate number.");
    }
  }

  const updatedUser = { ...users[userIndex], name, email, phone };
  users[userIndex] = updatedUser;

  if (currentUser.role === "driver") {
    drivers[driverIndex] = { ...drivers[driverIndex], name, phone, plateNumber };
    writeStoredValue(STORAGE_KEYS.drivers, drivers);
  }

  writeStoredValue(STORAGE_KEYS.users, users);
  return toPublicUser(updatedUser);
}

export function getCurrentUser() {
  const session = readStoredValue(STORAGE_KEYS.session, null);
  if (session === null) {
    return null;
  }
  if (!session || typeof session.userId !== "string") {
    throw new Error("Saved Rider session is invalid. Log in again.");
  }

  const user = getUsers().find((candidate) => candidate.id === session.userId);
  return user ? toPublicUser(user) : null;
}

export function logout() {
  getStorage().removeItem(STORAGE_KEYS.session);
}
