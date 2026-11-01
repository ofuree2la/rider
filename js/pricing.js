// Placeholder fare rules for the prototype. Replace these values with figures
// calculated from real campus costs per trip before using Rider operationally.
export const FARE_CONFIG = {
  currency: "NGN",
  roundingIncrement: 50,
  fareMatrix: {
    hostels: {
      hostels: 200,
      "campus-core": 300,
      "campus-edge": 350,
      nearby: 600,
    },
    "campus-core": {
      hostels: 300,
      "campus-core": 200,
      "campus-edge": 300,
      nearby: 550,
    },
    "campus-edge": {
      hostels: 350,
      "campus-core": 300,
      "campus-edge": 200,
      nearby: 400,
    },
    nearby: {
      hostels: 600,
      "campus-core": 550,
      "campus-edge": 400,
      nearby: 300,
    },
  },
  earlyMorningSurcharge: {
    enabled: true,
    start: "05:00",
    end: "08:00",
    amount: 100,
  },
  peakHourSurcharge: {
    enabled: true,
    windows: [
      { start: "07:00", end: "09:00" },
      { start: "16:00", end: "19:00" },
    ],
    percentage: 10,
    maxAmount: 100,
  },
  sharedRide: {
    enabled: true,
    minimumPassengers: 2,
    maximumPassengers: 3,
  },
};

function getZone(locationValue, fieldName) {
  if (typeof locationValue === "string" && locationValue.trim()) {
    return locationValue;
  }
  if (locationValue && typeof locationValue.zone === "string" && locationValue.zone) {
    return locationValue.zone;
  }
  throw new TypeError(`${fieldName} must be a location ID or an object with a zone.`);
}

function timeToMinutes(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError("Fare time must be a valid date.");
    }
    return value.getHours() * 60 + value.getMinutes();
  }

  if (typeof value === "string") {
    const timeMatch = value.match(/(?:^|T)(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/);
    if (timeMatch) {
      const hours = Number(timeMatch[1]);
      const minutes = Number(timeMatch[2]);
      if (hours <= 23 && minutes <= 59) {
        return hours * 60 + minutes;
      }
    }

    const parsedDate = new Date(value);
    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate.getHours() * 60 + parsedDate.getMinutes();
    }
  }

  throw new TypeError("Fare time must be a valid Date, time, or date-time string.");
}

function clockToMinutes(clockValue) {
  const [hours, minutes] = clockValue.split(":").map(Number);
  return hours * 60 + minutes;
}

function isWithinWindow(minutes, window) {
  return minutes >= clockToMinutes(window.start) && minutes < clockToMinutes(window.end);
}

function roundFare(amount) {
  const increment = FARE_CONFIG.roundingIncrement;
  return Math.round(amount / increment) * increment;
}

export function calculateFare(pickup, destination, time = new Date(), passengers = 1) {
  const pickupZone = getZone(pickup, "Pickup");
  const destinationZone = getZone(destination, "Destination");
  const passengerCount = Number(passengers);

  if (
    !Number.isInteger(passengerCount) ||
    passengerCount < 1 ||
    passengerCount > FARE_CONFIG.sharedRide.maximumPassengers
  ) {
    throw new RangeError(
      `Passenger count must be between 1 and ${FARE_CONFIG.sharedRide.maximumPassengers}.`,
    );
  }

  const matrixRow = FARE_CONFIG.fareMatrix[pickupZone];
  const configuredBaseFare = matrixRow?.[destinationZone];
  if (typeof configuredBaseFare !== "number" || configuredBaseFare < 0) {
    throw new Error(`No fare is configured from zone "${pickupZone}" to "${destinationZone}".`);
  }

  const timeInMinutes = timeToMinutes(time);
  let earlyMorningAmount = 0;
  let peakHourAmount = 0;

  const earlyMorning = FARE_CONFIG.earlyMorningSurcharge;
  if (earlyMorning.enabled && isWithinWindow(timeInMinutes, earlyMorning)) {
    earlyMorningAmount = earlyMorning.amount;
  }

  const peakHours = FARE_CONFIG.peakHourSurcharge;
  if (
    peakHours.enabled &&
    peakHours.windows.some((window) => isWithinWindow(timeInMinutes, window))
  ) {
    peakHourAmount = Math.min(
      configuredBaseFare * (peakHours.percentage / 100),
      peakHours.maxAmount,
    );
  }

  const fareBeforeShare = configuredBaseFare + earlyMorningAmount + peakHourAmount;
  const roundedRideTotal = roundFare(fareBeforeShare);
  const isSharedRide =
    FARE_CONFIG.sharedRide.enabled &&
    passengerCount >= FARE_CONFIG.sharedRide.minimumPassengers;

  if (!isSharedRide) {
    return {
      currency: FARE_CONFIG.currency,
      base: roundFare(configuredBaseFare),
      surcharge: roundFare(earlyMorningAmount + peakHourAmount),
      total: roundedRideTotal,
      rideTotal: roundedRideTotal,
      passengers: passengerCount,
      shared: false,
      surcharges: {
        earlyMorning: roundFare(earlyMorningAmount),
        peakHour: roundFare(peakHourAmount),
      },
    };
  }

  // Round each shared component per passenger so the displayed breakdown adds
  // up to the per-passenger total; rideTotal is the sum charged to the group.
  const basePerPassenger = roundFare(configuredBaseFare / passengerCount);
  const earlyMorningPerPassenger = roundFare(earlyMorningAmount / passengerCount);
  const peakHourPerPassenger = roundFare(peakHourAmount / passengerCount);
  const surchargePerPassenger = earlyMorningPerPassenger + peakHourPerPassenger;
  const totalPerPassenger = basePerPassenger + surchargePerPassenger;

  return {
    currency: FARE_CONFIG.currency,
    base: basePerPassenger,
    surcharge: surchargePerPassenger,
    total: totalPerPassenger,
    rideTotal: totalPerPassenger * passengerCount,
    passengers: passengerCount,
    shared: true,
    surcharges: {
      earlyMorning: earlyMorningPerPassenger,
      peakHour: peakHourPerPassenger,
    },
  };
}
