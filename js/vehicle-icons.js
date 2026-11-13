const SVG_NS = "http://www.w3.org/2000/svg";

const VEHICLE_SHAPES = {
  keke: [
    ["path", "body", "M17 43V26l9-10h30l11 12v15H17Z"],
    ["path", "window", "M29 20h15v12H21l8-12Zm19 0h8l8 9v3H48V20Z"],
    ["path", "detail", "M14 34h7v10h-7zM67 31h9v12h-9zM22 44h43"],
    ["circle", "wheel", "28 46 7"],
    ["circle", "wheel", "59 46 7"],
  ],
  minivan: [
    ["path", "body", "M12 41V24a7 7 0 0 1 7-7h34l13 12v12H12Z"],
    ["path", "window", "M20 21h14v12H17v-8a4 4 0 0 1 3-4Zm18 0h13l9 9v3H38V21Z"],
    ["path", "detail", "M13 34h55M17 41h48"],
    ["circle", "wheel", "25 45 7"],
    ["circle", "wheel", "57 45 7"],
  ],
  bike: [
    ["path", "body", "M31 34h8l7-9h9l5 8-7 3-6-5-7 9h-8l-5-7"],
    ["path", "window", "M46 23l4-7h8l5 5"],
    ["path", "detail", "M39 25h-8l-4 5m32 3h7"],
    ["circle", "wheel", "25 43 9"],
    ["circle", "wheel", "64 43 9"],
  ],
};

function createSvgNode(name, className, shape) {
  const element = document.createElementNS(SVG_NS, name);
  if (className) {
    element.setAttribute("class", `rider-vehicle-icon__${className}`);
  }
  if (name === "circle") {
    const [cx, cy, radius] = shape.split(" ");
    element.setAttribute("cx", cx);
    element.setAttribute("cy", cy);
    element.setAttribute("r", radius);
  } else {
    element.setAttribute("d", shape);
  }
  return element;
}

export function createVehicleIcon(vehicleType, { animated = false, label = "" } = {}) {
  const type = VEHICLE_SHAPES[vehicleType] ? vehicleType : "keke";
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.setAttribute("viewBox", "0 0 88 60");
  icon.setAttribute("class", `rider-vehicle-icon${animated ? " rider-vehicle-icon--animated" : ""}`);
  icon.setAttribute("aria-hidden", label ? "false" : "true");
  icon.setAttribute("focusable", "false");
  if (label) {
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = label;
    icon.append(title);
    icon.setAttribute("role", "img");
  }
  for (const [name, className, shape] of VEHICLE_SHAPES[type]) {
    const node = createSvgNode(name, className, shape);
    if (className === "body" || className === "window" || className === "detail") {
      const group = icon.querySelector(".rider-vehicle-icon__body");
      if (className === "body") {
        const bodyGroup = document.createElementNS(SVG_NS, "g");
        bodyGroup.setAttribute("class", "rider-vehicle-icon__body");
        bodyGroup.append(node);
        icon.append(bodyGroup);
      } else if (group) {
        group.append(node);
      }
    } else {
      icon.append(node);
    }
  }
  return icon;
}
