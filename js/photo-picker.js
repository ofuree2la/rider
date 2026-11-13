const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const pickerStates = new WeakMap();
let activeEditor = null;
let activeInput = null;
let activeImage = null;
let activeImageClose = null;
let activeShape = "profile";
let zoom = 1;
let offsetX = 0;
let offsetY = 0;
let dragPointer = null;
let pinchDistance = null;
let pinchZoom = null;
let pointers = new Map();

function createElement(tagName, className, text = "") {
  const element = document.createElement(tagName);
  element.className = className;
  if (text) {
    element.textContent = text;
  }
  return element;
}

function makeEditor() {
  const dialog = createElement("dialog", "photo-editor");
  dialog.setAttribute("aria-labelledby", "photo-editor-title");

  const layout = createElement("div", "photo-editor__layout");
  const header = createElement("header", "photo-editor__header");
  const title = createElement("h2", "", "Adjust your photo");
  title.id = "photo-editor-title";
  const closeButton = createElement("button", "photo-editor__cancel", "Cancel");
  closeButton.type = "button";
  header.append(title, closeButton);

  const instructions = createElement(
    "p",
    "photo-editor__instructions",
    "Drag to reposition, and use the slider or pinch to zoom.",
  );
  const canvasWrap = createElement("div", "photo-editor__canvas-wrap");
  const canvas = createElement("canvas", "photo-editor__canvas");
  canvas.width = 480;
  canvas.height = 480;
  canvas.setAttribute("aria-hidden", "true");
  const guide = createElement("div", "photo-editor__guide");
  guide.setAttribute("aria-hidden", "true");
  canvasWrap.append(canvas, guide);

  const zoomControl = createElement("div", "photo-editor__zoom-control");
  const zoomLabel = createElement("label", "", "Zoom");
  zoomLabel.htmlFor = "photo-editor-zoom";
  const zoomSlider = createElement("input", "photo-editor__zoom");
  zoomSlider.id = "photo-editor-zoom";
  zoomSlider.type = "range";
  zoomSlider.min = "100";
  zoomSlider.max = "300";
  zoomSlider.step = "1";
  zoomSlider.value = "100";
  zoomSlider.setAttribute("aria-label", "Zoom photo");
  zoomControl.append(zoomLabel, zoomSlider);

  const error = createElement("p", "photo-editor__error");
  error.setAttribute("role", "alert");
  const actions = createElement("div", "photo-editor__actions");
  const cancelButton = createElement("button", "photo-editor__cancel", "Cancel");
  cancelButton.type = "button";
  const useButton = createElement("button", "photo-editor__use", "Use photo");
  useButton.type = "button";
  actions.append(cancelButton, useButton);
  layout.append(header, instructions, canvasWrap, zoomControl, error, actions);
  dialog.append(layout);
  document.body.append(dialog);
  return { dialog, canvas, zoomSlider, error, closeButton, cancelButton, useButton };
}

function getCanvasSize() {
  return activeShape === "vehicle" ? { width: 640, height: 480 } : { width: 480, height: 480 };
}

function clampOffset() {
  if (!activeImage) {
    return;
  }
  const { width, height } = getCanvasSize();
  const scale = Math.max(width / activeImage.width, height / activeImage.height) * zoom;
  const overflowX = Math.max(0, (activeImage.width * scale - width) / 2);
  const overflowY = Math.max(0, (activeImage.height * scale - height) / 2);
  offsetX = Math.max(-overflowX, Math.min(overflowX, offsetX));
  offsetY = Math.max(-overflowY, Math.min(overflowY, offsetY));
}

function drawPreview() {
  if (!activeEditor || !activeImage) {
    return;
  }
  const { canvas } = activeEditor;
  const { width, height } = getCanvasSize();
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const scale = Math.max(width / activeImage.width, height / activeImage.height) * zoom;
  const drawWidth = activeImage.width * scale;
  const drawHeight = activeImage.height * scale;
  const x = (width - drawWidth) / 2 + offsetX;
  const y = (height - drawHeight) / 2 + offsetY;
  context.clearRect(0, 0, width, height);
  context.drawImage(activeImage, x, y, drawWidth, drawHeight);
}

function closeImage() {
  activeImageClose?.();
  activeImageClose = null;
  activeImage = null;
}

function closeEditor(accepted) {
  if (!activeInput || !activeEditor) {
    return;
  }
  const input = activeInput;
  const state = pickerStates.get(input);
  activeEditor.dialog.close();
  closeImage();
  input.value = "";
  pointers.clear();
  dragPointer = null;
  pinchDistance = null;
  pinchZoom = null;
  activeInput = null;
  if (!accepted) {
    if (state) {
      state.selectedFile = null;
      state.status.hidden = true;
    }
    input.focus();
    input.dispatchEvent(new CustomEvent("photo-picker:cancel"));
  }
}

async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { image: bitmap, close: () => bitmap.close() };
    } catch (error) {
      if (error instanceof TypeError) {
        const bitmap = await createImageBitmap(file);
        return { image: bitmap, close: () => bitmap.close() };
      }
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { image, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function downscaleDecodedImage(decoded) {
  const maxDimension = Math.max(decoded.image.width, decoded.image.height);
  if (maxDimension <= 2048) {
    return decoded;
  }
  const ratio = 2048 / maxDimension;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(decoded.image.width * ratio));
  canvas.height = Math.max(1, Math.round(decoded.image.height * ratio));
  const context = canvas.getContext("2d");
  context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
  decoded.close();
  return { image: canvas, close() {} };
}

async function openEditor(input, file, state) {
  if (!ACCEPTED_TYPES.has(file.type)) {
    throw new TypeError("Choose a JPG, PNG, or WebP photo.");
  }
  if (file.size === 0 || file.size > MAX_FILE_SIZE) {
    throw new RangeError("Choose a photo smaller than 5 MB.");
  }

  const decoded = downscaleDecodedImage(await decodeImage(file));
  activeImage = decoded.image;
  activeImageClose = decoded.close;
  activeInput = input;
  activeShape = state.shape;
  zoom = 1;
  offsetX = 0;
  offsetY = 0;
  pointers.clear();
  const { dialog, zoomSlider, error } = activeEditor;
  dialog.dataset.shape = activeShape;
  dialog.querySelector("#photo-editor-title").textContent =
    activeShape === "vehicle" ? "Adjust vehicle photo" : "Adjust profile photo";
  zoomSlider.value = "100";
  error.textContent = "";
  drawPreview();
  dialog.showModal();
  activeEditor.closeButton.focus();
}

function distanceBetweenPointers() {
  const [first, second] = [...pointers.values()];
  if (!first || !second) {
    return 0;
  }
  return Math.hypot(first.x - second.x, first.y - second.y);
}

async function createCroppedFile() {
  const { width, height } = getCanvasSize();
  const output = document.createElement("canvas");
  output.width = width === height ? 512 : 1024;
  output.height = width === height ? 512 : 768;
  const context = output.getContext("2d", { alpha: false });
  const scale = Math.max(width / activeImage.width, height / activeImage.height) * zoom;
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (activeImage.width - sourceWidth) / 2 - offsetX / scale;
  const sourceY = (activeImage.height - sourceHeight) / 2 - offsetY / scale;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, output.width, output.height);
  context.drawImage(
    activeImage,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    output.width,
    output.height,
  );
  const blob = await new Promise((resolve, reject) => {
    output.toBlob(
      (result) => result ? resolve(result) : reject(new Error("The edited photo could not be exported.")),
      "image/jpeg",
      0.88,
    );
  });
  return new File([blob], "rider-photo.jpg", { type: "image/jpeg", lastModified: Date.now() });
}

function installEditorHandlers() {
  const { dialog, canvas, zoomSlider, closeButton, cancelButton, useButton, error } = activeEditor;
  const cancel = () => closeEditor(false);
  closeButton.addEventListener("click", cancel);
  cancelButton.addEventListener("click", cancel);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    cancel();
  });
  zoomSlider.addEventListener("input", () => {
    zoom = Number(zoomSlider.value) / 100;
    clampOffset();
    drawPreview();
  });
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      dragPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    } else if (pointers.size === 2) {
      pinchDistance = distanceBetweenPointers();
      pinchZoom = zoom;
      dragPointer = null;
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) {
      return;
    }
    const previous = pointers.get(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1 && dragPointer?.id === event.pointerId) {
      const rect = canvas.getBoundingClientRect();
      offsetX += (event.clientX - previous.x) * (canvas.width / rect.width);
      offsetY += (event.clientY - previous.y) * (canvas.height / rect.height);
      dragPointer.x = event.clientX;
      dragPointer.y = event.clientY;
      clampOffset();
      drawPreview();
    } else if (pointers.size === 2 && pinchDistance) {
      zoom = Math.max(1, Math.min(3, pinchZoom * distanceBetweenPointers() / pinchDistance));
      zoomSlider.value = String(Math.round(zoom * 100));
      clampOffset();
      drawPreview();
    }
  });
  const releasePointer = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) {
      pinchDistance = null;
      pinchZoom = null;
    }
    if (pointers.size === 1) {
      const [pointerId, point] = [...pointers.entries()][0];
      dragPointer = { id: pointerId, ...point };
    } else if (pointers.size === 0) {
      dragPointer = null;
    }
  };
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  useButton.addEventListener("click", async () => {
    useButton.disabled = true;
    error.textContent = "";
    try {
      const croppedFile = await createCroppedFile();
      const input = activeInput;
      const state = pickerStates.get(input);
      state.selectedFile = croppedFile;
      setPhotoPickerMessage(input, "Photo ready. Save to upload it.", "success");
      input.dispatchEvent(new CustomEvent("photo-picker:ready", { detail: { file: croppedFile } }));
      closeEditor(true);
      input.focus();
    } catch (cropError) {
      error.textContent = cropError.message || "The edited photo could not be prepared.";
    } finally {
      useButton.disabled = false;
    }
  });
}

function setPhotoPickerMessage(input, message, status = "idle") {
  const state = pickerStates.get(input);
  if (!state) {
    return;
  }
  state.status.replaceChildren();
  state.status.dataset.state = status;
  state.status.hidden = !message;
  if (message) {
    if (status === "uploading") {
      const spinner = createElement("span", "photo-picker-status__spinner");
      spinner.setAttribute("aria-hidden", "true");
      state.status.append(spinner);
    }
    state.status.append(document.createTextNode(message));
  }
}

export function attachPhotoPicker(input, { shape = "profile" } = {}) {
  if (!(input instanceof HTMLInputElement) || input.type !== "file") {
    throw new TypeError("The photo picker must be attached to a file input.");
  }
  if (!["profile", "vehicle"].includes(shape)) {
    throw new TypeError("Choose a profile or vehicle crop shape.");
  }
  if (!activeEditor) {
    activeEditor = makeEditor();
    installEditorHandlers();
  }

  const status = createElement("p", "photo-picker-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  input.insertAdjacentElement("afterend", status);
  const state = { shape, status, selectedFile: null };
  pickerStates.set(input, state);

  input.addEventListener("change", async () => {
    state.selectedFile = null;
    const file = input.files?.[0];
    if (!file) {
      setPhotoPickerMessage(input, "");
      return;
    }
    setPhotoPickerMessage(input, "");
    try {
      await openEditor(input, file, state);
    } catch (error) {
      input.value = "";
      setPhotoPickerMessage(input, error.message || "The photo could not be opened.", "error");
    }
  });

  return {
    getFile: () => state.selectedFile,
    setStatus: (message, value) => setPhotoPickerMessage(input, message, value),
    clear: () => {
      state.selectedFile = null;
      input.value = "";
      setPhotoPickerMessage(input, "");
    },
    destroy: () => {
      if (activeInput === input) {
        closeEditor(false);
      }
      status.remove();
      pickerStates.delete(input);
    },
  };
}
