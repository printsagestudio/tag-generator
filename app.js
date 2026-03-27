// ─── PDF Generation ──────────────────────────────────────────────────────────
async function generatePDF() {
  const btn = document.getElementById("btnDownload");

  // Grab current values for filename
  const n1 = document.getElementById("name1").value || "Taylor";
  const n2 = document.getElementById("name2").value || "Cynthia";
  const filename = `wedding-tags-${n1.toLowerCase()}-${n2.toLowerCase()}.pdf`.replace(
    /\s+/g,
    "-"
  );

  // Disable button & show loading state
  btn.disabled = true;
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite">
      <circle cx="12" cy="12" r="10" stroke-opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round" />
    </svg>
    Generating PDF…
  `;

  try {
    // Ensure external tag background is loaded before html2canvas renders.
    await loadTagBackground();

    // Ensure web fonts are ready so text measurement/layout stabilizes.
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    } catch (e) {
      // Non-fatal: continue even if fonts API isn't available.
    }

    // Apply the latest typed values immediately (bypasses debounce delay).
    _doUpdateTag();
    // Allow a paint cycle so DOM updates + styles apply before capture.
    await new Promise((r) => requestAnimationFrame(r));

    const tagEl = document.getElementById("theTag");

    // Target: 300 DPI on A4
    // Work out exactly how many pixels each tag slot occupies at 300 DPI,
    // then tell html2canvas to render at that native size — no upscaling later.
    const DPI = 300;
    const MM_PER_INCH = 25.4;
    const A4_W_MM = 210,
      A4_H_MM = 297;
    const COLS = 4,
      ROWS = 3;
    const MARGIN_MM = 8,
      GAP_MM = 4;

    const tagW_MM = (A4_W_MM - MARGIN_MM * 2 - GAP_MM * (COLS - 1)) / COLS; // ~44.25 mm
    const tagH_MM = (A4_H_MM - MARGIN_MM * 2 - GAP_MM * (ROWS - 1)) / ROWS; // ~89.67 mm

    // Pixel size for one tag at 300 DPI
    const tagW_PX = Math.round((tagW_MM / MM_PER_INCH) * DPI); // ~522 px
    const tagH_PX = Math.round((tagH_MM / MM_PER_INCH) * DPI); // ~1058 px

    // html2canvas scale = desired px / actual DOM px
    const domW = tagEl.offsetWidth || 260;
    const domH = tagEl.offsetHeight || 490;
    const scale = Math.max(tagW_PX / domW, tagH_PX / domH);

    const canvas = await html2canvas(tagEl, {
      scale,
      useCORS: true,
      allowTaint: false,
      backgroundColor: null,
      logging: false,
    });

    // Lossless PNG — zero quality loss
    const imgData = canvas.toDataURL("image/png");

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
      compress: true,
    });

    // White background
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, A4_W_MM, A4_H_MM, "F");

    // Place first tag AND register the image in jsPDF's cache under an alias.
    // Every subsequent addImage call with the same alias reuses the cached bitmap
    // → the image data is embedded only once, keeping file size reasonable.
    const IMG_ALIAS = "tag";
    pdf.addImage(
      imgData,
      "PNG",
      MARGIN_MM,
      MARGIN_MM,
      tagW_MM,
      tagH_MM,
      IMG_ALIAS,
      "NONE"
    );

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (row === 0 && col === 0) continue; // already drawn above
        const x = MARGIN_MM + col * (tagW_MM + GAP_MM);
        const y = MARGIN_MM + row * (tagH_MM + GAP_MM);
        pdf.addImage(imgData, "PNG", x, y, tagW_MM, tagH_MM, IMG_ALIAS, "NONE");
      }
    }

    // Subtle footer
    pdf.setFontSize(5);
    pdf.setTextColor(180, 160, 140);
    pdf.text(
      "Tag & Bloom · 12 Custom Wedding Tags · Print at 100% on A4",
      A4_W_MM / 2,
      A4_H_MM - 2.5,
      { align: "center" }
    );

    pdf.save(filename);
  } catch (err) {
    console.error("PDF generation failed:", err);
    const msg = err?.message ? `\n\nDetails: ${err.message}` : "";
    alert(`Oops — could not generate the PDF. Please try again.${msg}`);
  } finally {
    // Restore button
    btn.disabled = false;
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      Download PDF — 12 Tags
    `;
  }
}

let _tagBackgroundPromise = null;
function loadTagBackground() {
  if (_tagBackgroundPromise) return _tagBackgroundPromise;

  const imgEl = document.getElementById("tagBgImg");
  if (!imgEl) return Promise.resolve();

  _tagBackgroundPromise = new Promise((resolve) => {
    imgEl.crossOrigin = "anonymous";
    imgEl.onload = () => resolve();
    imgEl.onerror = () => {
      console.warn("Could not load ./tag.png");
      resolve();
    };
    imgEl.src = "./tag.png";
  });

  return _tagBackgroundPromise;
}

// Close on overlay click (safe even if modal overlay isn't present)
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", function (e) {
    if (e.target === this) this.classList.remove("show");
  });
});

const _measureCanvas = document.createElement("canvas");
const _measureCtx = _measureCanvas.getContext("2d");

function measureTextWidth(text, font) {
  _measureCtx.font = font;
  return _measureCtx.measureText(text).width;
}

function fitCouple(el, n1, n2, maxWidth) {
  const baseFont = "400 1rem Jost, sans-serif";
  const fullText = (n1 + " & " + n2).toUpperCase();

  // Step 1: find the right letter-spacing without touching the DOM in a loop
  let spacing = 0.15;
  // Each character adds spacing * fontSize px; estimate fontSize = 16px
  const charCount = fullText.length;
  const fontSize = 16;
  let textW = measureTextWidth(fullText, baseFont) + charCount * spacing * fontSize;

  if (textW <= maxWidth) {
    el.style.whiteSpace = "nowrap";
    el.style.fontSize = "1rem";
    el.style.letterSpacing = spacing + "em";
    el.innerHTML = n1 + ` <span class="couple-amp">&amp;</span> ` + n2;
    return;
  }

  // Find minimum spacing needed (down to 0)
  while (spacing > 0) {
    spacing = Math.round((spacing - 0.01) * 100) / 100;
    textW = measureTextWidth(fullText, baseFont) + charCount * spacing * fontSize;
    if (textW <= maxWidth) break;
  }

  if (textW <= maxWidth) {
    el.style.whiteSpace = "nowrap";
    el.style.fontSize = "1rem";
    el.style.letterSpacing = spacing + "em";
    el.innerHTML = n1 + ` <span class="couple-amp">&amp;</span> ` + n2;
  } else {
    // Wrap to two lines
    el.style.whiteSpace = "normal";
    el.style.fontSize = "1rem";
    el.style.letterSpacing = "0.1em";
    el.innerHTML = n1 + ` <span class="couple-amp">&amp;</span> ` + n2;
  }
}

function fitTagline(el, maxWidth) {
  const baseFont = 'italic 300 0.85rem "Cormorant Garamond", serif';
  const text = el.textContent;
  const fontSize = 13.6; // 0.85rem ≈ 13.6px

  let spacing = 0.04;
  let textW = measureTextWidth(text, baseFont) + text.length * spacing * fontSize;

  if (textW <= maxWidth) {
    el.style.whiteSpace = "nowrap";
    el.style.fontSize = "0.85rem";
    el.style.letterSpacing = spacing + "em";
    return;
  }

  while (spacing > -0.05) {
    spacing = Math.round((spacing - 0.01) * 100) / 100;
    textW = measureTextWidth(text, baseFont) + text.length * spacing * fontSize;
    if (textW <= maxWidth) break;
  }

  if (textW <= maxWidth) {
    el.style.whiteSpace = "nowrap";
    el.style.fontSize = "0.85rem";
    el.style.letterSpacing = spacing + "em";
  } else {
    el.style.whiteSpace = "normal";
    el.style.fontSize = "0.85rem";
    el.style.letterSpacing = "0em";
  }
}

let _updateTagTimer = null;
function updateTag() {
  // Debounce: wait 80ms after last keystroke before updating the preview
  clearTimeout(_updateTagTimer);
  _updateTagTimer = setTimeout(_doUpdateTag, 80);
}

function _doUpdateTag() {
  const n1 = document.getElementById("name1").value || "Taylor";
  const n2 = document.getElementById("name2").value || "Cynthia";
  const dateRaw = document.getElementById("wdate").value;
  const tagline = document.getElementById("tagline").value || "Forever starts today";

  // Format date
  let dateStr = "12 | 22 | 2030";
  if (dateRaw) {
    const [y, m, d] = dateRaw.split("-");
    dateStr = `${m} | ${d} | ${y}`;
  }

  const coupleEl = document.getElementById("preview-couple");
  const taglineEl = document.getElementById("preview-tagline");

  // Batch all DOM writes together (no interleaved reads)
  coupleEl.innerHTML = `${n1} &amp; ${n2}`;
  document.getElementById("preview-date").textContent = dateStr;
  taglineEl.textContent = tagline;

  // Fit to tag width (~220px usable)
  const maxW = 220;
  fitCouple(coupleEl, n1, n2, maxW);
  fitTagline(taglineEl, maxW);

  // Pulse — use requestAnimationFrame to avoid forced reflow
  const tag = document.getElementById("theTag");
  tag.classList.remove("updating");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => tag.classList.add("updating"));
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  await loadTagBackground();
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  } catch (e) {
    // Ignore: fonts-ready is a performance hint, not required for functionality.
  }
  // Set initial preview immediately (no debounce delay).
  _doUpdateTag();
});

// Expose to inline handlers in index.html
window.generatePDF = generatePDF;
window.updateTag = updateTag;

