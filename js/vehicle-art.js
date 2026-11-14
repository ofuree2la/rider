const VEHICLES = {
  keke: {
    label: "Keke motor tricycle, side view",
    svg: `
      <g class="vehicle-art-speed">
        <path d="M12 91h19M4 101h24M16 111h13"/>
      </g>
      <g class="vehicle-art-body">
        <path class="vehicle-art-canopy" d="M38 31Q39 25 47 25h113q8 0 13 7l7 7H38z"/>
        <path class="vehicle-art-frame" d="M52 39v50M164 39l15 47M101 39v48M52 87h116"/>
        <path class="vehicle-art-seat" d="M128 75h25v7h-25zm-54 4h26v6H74z"/>
        <path class="vehicle-art-body-fill" d="M26 96l7-21q4-11 16-14l26-4 14 12h42l16 7 9 23-5 10H35z"/>
        <path class="vehicle-art-stripe" d="M34 91h121l5 8H31z"/>
        <path class="vehicle-art-nose" d="M152 76l22-5q13 2 20 12l8 13-7 12h-25l-8-18z"/>
        <path class="vehicle-art-windscreen" d="M166 42q11 2 16 11l10 27-16-5-17-26z"/>
        <path class="vehicle-art-detail" d="M157 57l11 18M185 83l13 4M43 69h11M179 106h17"/>
        <path class="vehicle-art-light" d="M195 88a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/>
        <path class="vehicle-art-handle" d="M152 70l-3-7 8-3m-9 3-6 2"/>
        <path class="vehicle-art-fender" d="M48 101a27 27 0 0 1 53 0M180 104a18 18 0 0 1 35 0"/>
      </g>
      <g class="vehicle-art-wheel-rotor">
        <circle class="vehicle-art-tire" cx="75" cy="105" r="22"/>
        <circle class="vehicle-art-hub" cx="75" cy="105" r="12"/>
        <path class="vehicle-art-spokes" d="M75 84v42m-21-21h42M60 90l30 30m0-30-30 30"/>
        <circle class="vehicle-art-axle" cx="75" cy="105" r="3"/>
      </g>
      <g class="vehicle-art-wheel-rotor vehicle-art-front-wheel">
        <circle class="vehicle-art-tire" cx="197" cy="108" r="14"/>
        <circle class="vehicle-art-hub" cx="197" cy="108" r="7"/>
        <path class="vehicle-art-spokes" d="M197 95v26m-13-13h26m-22-9 18 18m0-18-18 18"/>
        <circle class="vehicle-art-axle" cx="197" cy="108" r="2.5"/>
      </g>
    `,
  },
  bike: {
    label: "Motorcycle with parcel, side view",
    svg: `
      <g class="vehicle-art-speed">
        <path d="M8 83h23M3 94h19M16 105h16"/>
      </g>
      <g class="vehicle-art-body">
        <path class="vehicle-art-frame" d="M54 102l23-38 35 39H54l29-30h29l23 30M112 103l24-34"/>
        <path class="vehicle-art-tank" d="M72 65q3-14 19-16h18l12 16-12 11H84z"/>
        <path class="vehicle-art-seat" d="M57 55q12-8 29-5l11 6-4 7H59z"/>
        <path class="vehicle-art-body-fill" d="M111 69l14-10 12 4-5 8-12 5z"/>
        <path class="vehicle-art-handle" d="M132 61l7-12 11 1m-13 3 8 5"/>
        <path class="vehicle-art-light" d="M143 55a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"/>
        <path class="vehicle-art-detail" d="M54 55l-8-8m3 0 7 7M65 102l14 7h30M61 91h13"/>
        <path class="vehicle-art-exhaust" d="M94 93h27l12 8h-33z"/>
        <path class="vehicle-art-parcel" d="M20 42h37v35H20z"/>
        <path class="vehicle-art-parcel-line" d="M20 52h37M38 42v35"/>
        <path class="vehicle-art-parcel-mark" d="M31 65l3-7 4 5 4-7m-11 8 5 1"/>
      </g>
      <g class="vehicle-art-wheel-rotor">
        <circle class="vehicle-art-tire" cx="54" cy="103" r="23"/>
        <circle class="vehicle-art-hub" cx="54" cy="103" r="12"/>
        <path class="vehicle-art-spokes" d="M54 81v44m-22-22h44m-38-16 32 32m0-32-32 32"/>
        <circle class="vehicle-art-axle" cx="54" cy="103" r="3"/>
      </g>
      <g class="vehicle-art-wheel-rotor">
        <circle class="vehicle-art-tire" cx="139" cy="103" r="23"/>
        <circle class="vehicle-art-hub" cx="139" cy="103" r="12"/>
        <path class="vehicle-art-spokes" d="M139 81v44m-22-22h44m-38-16 32 32m0-32-32 32"/>
        <circle class="vehicle-art-axle" cx="139" cy="103" r="3"/>
      </g>
    `,
  },
  minivan: {
    label: "Minibus, side view",
    svg: `
      <g class="vehicle-art-speed">
        <path d="M4 51h26M12 62h20M2 73h22"/>
      </g>
      <g class="vehicle-art-body">
        <path class="vehicle-art-body-fill" d="M25 42q0-9 10-10h112l38 20v49H25z"/>
        <path class="vehicle-art-window" d="M39 39h34v27H36V45q0-6 3-6zm40 0h32v27H79zm38 0h20l31 18v9h-51z"/>
        <path class="vehicle-art-detail" d="M75 38v61M115 38v61M27 72h156M126 73h30v18h-30z"/>
        <path class="vehicle-art-bumper" d="M25 91h13v9H25m148-9h9v9h-9"/>
        <path class="vehicle-art-light" d="M179 76h7v10h-7z"/>
        <path class="vehicle-art-grille" d="M183 88h3m-3 4h3"/>
        <path class="vehicle-art-fender" d="M42 100a20 20 0 0 1 40 0m72 0a20 20 0 0 1 40 0"/>
      </g>
      <g class="vehicle-art-wheel-rotor">
        <circle class="vehicle-art-tire" cx="62" cy="101" r="19"/>
        <circle class="vehicle-art-hub" cx="62" cy="101" r="10"/>
        <path class="vehicle-art-spokes" d="M62 83v36m-18-18h36m-31-13 26 26m0-26-26 26"/>
        <circle class="vehicle-art-axle" cx="62" cy="101" r="2.5"/>
      </g>
      <g class="vehicle-art-wheel-rotor">
        <circle class="vehicle-art-tire" cx="172" cy="101" r="19"/>
        <circle class="vehicle-art-hub" cx="172" cy="101" r="10"/>
        <path class="vehicle-art-spokes" d="M172 83v36m-18-18h36m-31-13 26 26m0-26-26 26"/>
        <circle class="vehicle-art-axle" cx="172" cy="101" r="2.5"/>
      </g>
    `,
  },
};

let nextTitleId = 0;

export function getRideVehicleArtType(ride) {
  if (ride.serviceType === "delivery" || ride.vehicleType === "bike") {
    return "bike";
  }
  return ride.vehicleType === "minivan" ? "minivan" : "keke";
}

export function createVehicleArt(type, animated = false) {
  const vehicle = VEHICLES[type];
  if (!vehicle) {
    throw new TypeError(`Unknown vehicle: ${type}`);
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const titleId = `vehicle-art-title-${nextTitleId++}`;
  svg.setAttribute("viewBox", "0 0 240 140");
  svg.setAttribute("class", `vehicle-art${animated ? " vehicle-art--animated" : ""}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-labelledby", titleId);
  svg.setAttribute("focusable", "false");
  const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
  title.setAttribute("id", titleId);
  title.textContent = vehicle.label;
  svg.append(title);
  const art = document.createElementNS("http://www.w3.org/2000/svg", "g");
  art.innerHTML = vehicle.svg;
  svg.append(art);
  return svg;
}
