import { createVehicleArt } from "./vehicle-art.js";

const preview = document.querySelector("#vehicle-preview");
const vehicleNames = { keke: "Keke", bike: "Motorbike with parcel", minivan: "Minibus" };

for (const type of Object.keys(vehicleNames)) {
  const section = document.createElement("section");
  section.className = "vehicle-preview-section";
  const heading = document.createElement("h2");
  heading.textContent = vehicleNames[type];
  const grid = document.createElement("div");
  grid.className = "vehicle-preview-grid";

  for (const theme of ["light", "dark"]) {
    for (const motion of ["static", "animated"]) {
      for (const size of ["large", "small"]) {
        const card = document.createElement("article");
        card.className = `vehicle-preview-card vehicle-preview-card--${theme}`;
        const caption = document.createElement("p");
        caption.textContent = `${theme} · ${motion} · ${size}`;
        const art = createVehicleArt(type, motion === "animated");
        art.classList.add(`vehicle-art--${size}`);
        card.append(art, caption);
        grid.append(card);
      }
    }
  }
  section.append(heading, grid);
  preview.append(section);
}
