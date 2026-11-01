import { locations, mockDrivers, starterUsers } from "./mockData.js";

const STORAGE_KEYS = Object.freeze({
  users: "rider.users",
  session: "rider.session",
  rides: "rider.rides",
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
  return readCollection(STORAGE_KEYS.users, starterUsers);
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
  return clone(mockDrivers);
}

export function getRides(filters = {}) {
  const rides = getRidesFromStorage();

  return rides
    .filter((ride) => !filters.userId || ride.userId === filters.userId)
    .filter((ride) => !filters.status || ride.status === filters.status)
    .map(clone);
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
  if (!Number.isInteger(passengers) || passengers < 1 || passengers > 3) {
    throw new RangeError("Passenger count must be between 1 and 3.");
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

export function login(email, password) {
  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
    throw new TypeError("Enter your email and password.");
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = getUsers().find((candidate) => candidate.email.toLowerCase() === normalizedEmail);

  if (!user || user.password !== password) {
    throw new Error("Email or password is incorrect.");
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
  const role = userInput.role ?? "student";

  if (!name) {
    throw new Error("Enter your name.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }
  if (role !== "student" && role !== "driver") {
    throw new Error("Choose a valid account type.");
  }

  const users = getUsers();
  if (users.some((user) => user.email.toLowerCase() === email)) {
    throw new Error("An account with this email already exists.");
  }

  const user = {
    ...clone(userInput),
    id: makeId("user"),
    name,
    email,
    role,
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  writeStoredValue(STORAGE_KEYS.users, users);
  writeStoredValue(STORAGE_KEYS.session, {
    userId: user.id,
    createdAt: new Date().toISOString(),
  });

  return toPublicUser(user);
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
