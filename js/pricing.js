import { locations } from "./mockData.js?v=seats4";

// PLACEHOLDER flat fares. Replace them with real figures from a cost-per-trip
// calculation before using Rider operationally. These are final fares per rider;
// time-based surcharges are disabled to keep the fare predictable.
export const FARE_CONFIG = {
  currency: "NGN",
  roundingIncrement: 50,
  fareMatrix: {
    standard: {
      standard: 200,
      campus: 200,
      "premium-hostel": 300,
    },
    campus: {
      standard: 200,
      campus: 200,
      "premium-hostel": 300,
    },
    "premium-hostel": {
      standard: 300,
      campus: 300,
      "premium-hostel": 300,
    },
  },
  earlyMorningSurcharge: {
    enabled: false,
    start: "05:00",
    end: "08:00",
    amount: 0,
  },
  peakHourSurcharge: {
    enabled: false,
    windows: [
      { start: "07:00", end: "09:00" },
      { start: "16:00", end: "19:00" },
    ],
    percentage: 0,
    maxAmount: 0,
  },
  sharedRide: {
    enabled: false,
    minimumPassengers: 2,
    maximumPassengers: 4,
  },
};

function getZone(locationValue, fieldName) {
  if (typeof locationValue === "string" && locationValue.trim()) {
    const location = locations.find(
      (candidate) => candidate.id === locationValue || candidate.name === locationValue,
    );
    return location?.zone ?? locationValue;
  }
  if (locationValue && typeof locationValue.zone === "string" && locationValue.zone) {
    return locationValue.zone;
  }
  throw new TypeError(`${fieldName} must be a location ID, name, or object with a zone.`);
}

function roundFare(amount) {
  const increment = FARE_CONFIG.roundingIncrement;
  return Math.round(amount / increment) * increment;
}

export function calculateFare(pickup, destination, time = new Date(), passengers = 1) {
  // Keep the time parameter for callers that pass scheduled pickup times. Fixed
  // fares do not vary by time, so it intentionally has no effect on the estimate.
  void time;

  const pickupZone = getZone(pickup, "Pickup");
  const destinationZone = getZone(destination, "Destination");
  const passengerCount = Number(passengers);
  const maximumPassengers = FARE_CONFIG.sharedRide.maximumPassengers;

  if (!Number.isInteger(passengerCount) || passengerCount < 1 || passengerCount > maximumPassengers) {
    throw new RangeError(`Passenger count must be between 1 and ${maximumPassengers}.`);
  }

  const matrixRow = FARE_CONFIG.fareMatrix[pickupZone];
  const configuredFarePerPassenger = matrixRow?.[destinationZone];
  if (typeof configuredFarePerPassenger !== "number" || configuredFarePerPassenger < 0) {
    throw new Error(`No fare is configured from zone "${pickupZone}" to "${destinationZone}".`);
  }

  const farePerPassenger = roundFare(configuredFarePerPassenger);
  const groupTotal = farePerPassenger * passengerCount;

  return {
    currency: FARE_CONFIG.currency,
    base: farePerPassenger,
    surcharge: 0,
    perPassenger: farePerPassenger,
    total: groupTotal,
    rideTotal: groupTotal,
    passengers: passengerCount,
    shared: false,
    surcharges: {
      earlyMorning: 0,
      peakHour: 0,
    },
  };
}
