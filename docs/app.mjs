class ChunkReader {
  constructor(uint8Array, start = 0, length = uint8Array.length - start) {
    this.bytes = uint8Array;
    this.start = start;
    this.offset = start;
    this.end = start + length;
    this.name = "";
    this.view = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
  }

  get remaining() {
    return this.end - this.offset;
  }

  getName() {
    return this.name;
  }

  getSize() {
    return this.remaining;
  }

  canRead(size) {
    return size >= 0 && this.offset + size <= this.end;
  }

  readBytes(size) {
    if (!this.canRead(size)) {
      return null;
    }
    const out = this.bytes.slice(this.offset, this.offset + size);
    this.offset += size;
    return out;
  }

  readString(size) {
    const bytes = this.readBytes(size);
    if (!bytes) {
      return null;
    }
    return String.fromCharCode(...bytes).replace(/\0+$/, "");
  }

  readUInt8() {
    if (!this.canRead(1)) {
      return null;
    }
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readInt8() {
    if (!this.canRead(1)) {
      return null;
    }
    const value = this.view.getInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readUInt16() {
    if (!this.canRead(2)) {
      return null;
    }
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readUInt32() {
    if (!this.canRead(4)) {
      return null;
    }
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  getChunk() {
    if (this.remaining < 8) {
      return null;
    }

    const name = this.readString(4);
    const size = this.readUInt32();
    if (name === null || size === null) {
      return null;
    }

    const boundedSize = Math.min(size, this.remaining);
    const out = new ChunkReader(this.bytes, this.offset, boundedSize);
    out.name = name;
    this.offset += boundedSize;
    return out;
  }
}

function invalid(message, details = []) {
  return {
    valid: false,
    message,
    details: details.length ? details : [message],
    summary: null,
  };
}

function valid(summary, details) {
  return {
    valid: true,
    message: "SoundFont is valid.",
    details,
    summary,
  };
}

function loadSmplChunk(chunk, state) {
  const chunkSize = chunk.getSize();
  if (!chunkSize) {
    return invalid("`smpl` chunk is empty");
  }

  if (chunkSize % 2 !== 0) {
    return invalid("Invalid `smpl` chunk size");
  }

  const bytes = chunk.readBytes(chunkSize);
  if (!bytes) {
    return invalid("Unable to read `smpl` chunk");
  }

  state.sampleData16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  return null;
}

function loadPhdrChunk(chunk, state) {
  const entrySize = 38;
  const chunkSize = chunk.getSize();
  if (chunkSize % entrySize !== 0) {
    return invalid("Invalid `phdr` chunk size");
  }

  const numHeaders = chunkSize / entrySize;
  for (let i = 0; i < numHeaders; i += 1) {
    const entry = {
      name: chunk.readString(20),
      preset: chunk.readUInt16(),
      bank: chunk.readUInt16(),
      presetBagIndex: chunk.readUInt16(),
      library: chunk.readUInt32(),
      genre: chunk.readUInt32(),
      morphology: chunk.readUInt32(),
    };

    if (Object.values(entry).some((value) => value === null)) {
      return invalid("Unable to read `phdr` entry");
    }

    state.presetHeaders.push(entry);
  }

  if (state.presetHeaders.length < 2) {
    return invalid("`phdr` contains fewer than 2 records");
  }

  if (state.presetHeaders.at(-1).name.startsWith("EOP")) {
    state.presetHeaders.pop();
    return null;
  }

  return invalid("`phdr` missing EOP entry");
}

function loadPbagChunk(chunk, state) {
  const entrySize = 4;
  const chunkSize = chunk.getSize();
  if (chunkSize % entrySize !== 0) {
    return invalid("Invalid `pbag` chunk size");
  }

  const numBags = chunkSize / entrySize;
  for (let i = 0; i < numBags; i += 1) {
    const bag = {
      genIndex: chunk.readUInt16(),
      modIndex: chunk.readUInt16(),
    };

    if (Object.values(bag).some((value) => value === null)) {
      return invalid("Unable to read `pbag` entry");
    }

    state.presetBags.push(bag);
  }

  return null;
}

function loadPgenChunk(chunk, state) {
  const entrySize = 4;
  const chunkSize = chunk.getSize();
  if (chunkSize % entrySize !== 0) {
    return invalid("Invalid `pgen` chunk size");
  }

  const numGenerators = chunkSize / entrySize;
  for (let i = 0; i < numGenerators; i += 1) {
    const generator = {
      oper: chunk.readUInt16(),
      amount: chunk.readUInt16(),
    };

    if (Object.values(generator).some((value) => value === null)) {
      return invalid("Unable to read `pgen` entry");
    }

    state.presetZoneGenerators.push(generator);
  }

  return null;
}

function loadInstChunk(chunk, state) {
  const entrySize = 22;
  const chunkSize = chunk.getSize();
  if (chunkSize % entrySize !== 0) {
    return invalid("Invalid `inst` chunk size");
  }

  const numInstruments = chunkSize / entrySize;
  for (let i = 0; i < numInstruments; i += 1) {
    const instrument = {
      name: chunk.readString(20),
      instBagIndex: chunk.readUInt16(),
    };

    if (Object.values(instrument).some((value) => value === null)) {
      return invalid("Unable to read `inst` entry");
    }

    state.instruments.push(instrument);
  }

  if (state.instruments.length < 2) {
    return invalid("`inst` contains fewer than 2 records");
  }

  if (state.instruments.at(-1).name.startsWith("EOI")) {
    state.instruments.pop();
    return null;
  }

  return invalid("`inst` missing EOI entry");
}

function loadIbagChunk(chunk, state) {
  const entrySize = 4;
  const chunkSize = chunk.getSize();
  if (chunkSize % entrySize !== 0) {
    return invalid("Invalid `ibag` chunk size");
  }

  const numBags = chunkSize / entrySize;
  for (let i = 0; i < numBags; i += 1) {
    const bag = {
      genIndex: chunk.readUInt16(),
      modIndex: chunk.readUInt16(),
    };

    if (Object.values(bag).some((value) => value === null)) {
      return invalid("Unable to read `ibag` entry");
    }

    state.instrumentBags.push(bag);
  }

  return null;
}

function loadIgenChunk(chunk, state) {
  const entrySize = 4;
  const chunkSize = chunk.getSize();
  if (chunkSize % entrySize !== 0) {
    return invalid("Invalid `igen` chunk size");
  }

  const numGenerators = chunkSize / entrySize;
  for (let i = 0; i < numGenerators; i += 1) {
    const generator = {
      oper: chunk.readUInt16(),
      amount: chunk.readUInt16(),
    };

    if (Object.values(generator).some((value) => value === null)) {
      return invalid("Unable to read `igen` entry");
    }

    state.instrumentZoneGenerators.push(generator);
  }

  return null;
}

function loadShdrChunk(chunk, state) {
  const entrySize = 46;
  const chunkSize = chunk.getSize();
  if (chunkSize % entrySize !== 0) {
    return invalid("Invalid `shdr` chunk size");
  }

  const numHeaders = chunkSize / entrySize;
  for (let i = 0; i < numHeaders; i += 1) {
    const header = {
      name: chunk.readString(20),
      start: chunk.readUInt32(),
      end: chunk.readUInt32(),
      startLoop: chunk.readUInt32(),
      endLoop: chunk.readUInt32(),
      sampleRate: chunk.readUInt32(),
      originalPitch: chunk.readUInt8(),
      pitchCorrection: chunk.readInt8(),
      sampleLink: chunk.readUInt16(),
      sampleType: chunk.readUInt16(),
    };

    if (Object.values(header).some((value) => value === null)) {
      return invalid("Unable to read `shdr` entry");
    }

    state.sampleHeaders.push(header);
  }

  if (state.sampleHeaders.length < 2) {
    return invalid("`shdr` contains fewer than 2 records");
  }

  if (state.sampleHeaders.at(-1).name.startsWith("EOS")) {
    state.sampleHeaders.pop();
    return null;
  }

  return invalid("`shdr` missing EOS entry");
}

function loadSdtaChunk(chunk, state, details) {
  let subChunk = chunk.getChunk();
  while (subChunk) {
    if (subChunk.getName() === "smpl") {
      const error = loadSmplChunk(subChunk, state);
      if (error) {
        return error;
      }
      details.push("Read `sdta/smpl` sample data.");
    } else if (subChunk.getName() === "sm24") {
      details.push("Found optional `sdta/sm24` chunk. The original loader ignores it.");
    }

    subChunk = chunk.getChunk();
  }

  return null;
}

function loadPdtaChunk(chunk, state, details) {
  let subChunk = chunk.getChunk();
  while (subChunk) {
    switch (subChunk.getName()) {
      case "phdr": {
        const error = loadPhdrChunk(subChunk, state);
        if (error) return error;
        details.push("Read `pdta/phdr` preset headers.");
        break;
      }
      case "pbag": {
        const error = loadPbagChunk(subChunk, state);
        if (error) return error;
        details.push("Read `pdta/pbag` preset bags.");
        break;
      }
      case "pgen": {
        const error = loadPgenChunk(subChunk, state);
        if (error) return error;
        details.push("Read `pdta/pgen` preset generators.");
        break;
      }
      case "inst": {
        const error = loadInstChunk(subChunk, state);
        if (error) return error;
        details.push("Read `pdta/inst` instrument headers.");
        break;
      }
      case "ibag": {
        const error = loadIbagChunk(subChunk, state);
        if (error) return error;
        details.push("Read `pdta/ibag` instrument bags.");
        break;
      }
      case "igen": {
        const error = loadIgenChunk(subChunk, state);
        if (error) return error;
        details.push("Read `pdta/igen` instrument generators.");
        break;
      }
      case "shdr": {
        const error = loadShdrChunk(subChunk, state);
        if (error) return error;
        details.push("Read `pdta/shdr` sample headers.");
        break;
      }
      default:
        break;
    }

    subChunk = chunk.getChunk();
  }

  return null;
}

export function validateSoundFontBuffer(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const details = [];
  const state = {
    presetHeaders: [],
    sampleData16: null,
    presetBags: [],
    presetZoneGenerators: [],
    instruments: [],
    instrumentBags: [],
    instrumentZoneGenerators: [],
    sampleHeaders: [],
  };

  if (bytes.length === 0) {
    return invalid("SF2 file is empty");
  }

  const chunk = new ChunkReader(bytes);
  const riff = chunk.readString(4);
  if (riff === null) {
    return invalid("Failed to read RIFF");
  }
  if (riff !== "RIFF") {
    return invalid("RIFF chunk missing");
  }

  const riffSize = chunk.readUInt32();
  if (riffSize === null) {
    return invalid("Failed to read RIFF size");
  }
  if (riffSize !== bytes.length - 8) {
    return invalid("RIFF size mismatch", [
      `Expected RIFF size ${bytes.length - 8}, found ${riffSize}.`,
    ]);
  }

  const sfbk = chunk.readString(4);
  if (sfbk === null) {
    return invalid("Failed to read sfbk");
  }
  if (sfbk !== "sfbk") {
    return invalid("SoundFont bank (`sfbk`) missing");
  }

  details.push("RIFF and `sfbk` headers are valid.");

  let listChunk = chunk.getChunk();
  while (listChunk) {
    if (listChunk.getName() === "LIST") {
      const listType = listChunk.readString(4);
      if (listType === null) {
        return invalid("Failed to read list type");
      }

      if (listType === "INFO") {
        details.push("Found `LIST/INFO` metadata.");
      } else if (listType === "sdta") {
        const error = loadSdtaChunk(listChunk, state, details);
        if (error) return error;
      } else if (listType === "pdta") {
        const error = loadPdtaChunk(listChunk, state, details);
        if (error) return error;
      }
    }

    listChunk = chunk.getChunk();
  }

  if (state.presetHeaders.length === 0 || !state.sampleData16 || state.sampleData16.length === 0) {
    return invalid("Failed to load SF2 file", [
      "The file did not produce both preset headers and sample data, which the current loader requires.",
    ]);
  }

  return valid(
    {
      presets: state.presetHeaders.length,
      instruments: state.instruments.length,
      samples: state.sampleHeaders.length,
      sampleData16: state.sampleData16.length,
    },
    details,
  );
}

if (typeof document !== "undefined") {
  const fileInput = document.querySelector("#soundfont-file");
  const status = document.querySelector("#status");
  const summary = document.querySelector("#summary");
  const detailsSection = document.querySelector("#details");
  const detailsList = document.querySelector("#details-list");

  function setStatus(kind, title, message) {
    status.className = `status status-${kind}`;
    status.innerHTML = `<h2>${title}</h2><p>${message}</p>`;
  }

  function renderResult(result, fileName) {
    const title = result.valid ? `${fileName} is valid` : `${fileName} is not valid`;
    setStatus(result.valid ? "valid" : "invalid", title, result.message);

    detailsList.innerHTML = "";
    for (const detail of result.details) {
      const item = document.createElement("li");
      item.textContent = detail;
      detailsList.appendChild(item);
    }
    detailsSection.hidden = false;

    if (result.summary) {
      document.querySelector("#summary-presets").textContent = String(result.summary.presets);
      document.querySelector("#summary-instruments").textContent = String(result.summary.instruments);
      document.querySelector("#summary-samples").textContent = String(result.summary.samples);
      document.querySelector("#summary-sample-data").textContent = String(result.summary.sampleData16);
      summary.hidden = false;
    } else {
      summary.hidden = true;
    }
  }

  fileInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setStatus("idle", "Validating", `Reading ${file.name}...`);
    summary.hidden = true;
    detailsSection.hidden = true;
    detailsList.innerHTML = "";

    try {
      const buffer = await file.arrayBuffer();
      const result = validateSoundFontBuffer(buffer);
      renderResult(result, file.name);
    } catch (error) {
      renderResult(
        invalid("The file could not be read in the browser.", [
          error instanceof Error ? error.message : String(error),
        ]),
        file.name,
      );
    }
  });
}
