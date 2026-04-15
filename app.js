const form = document.getElementById("contractForm");
const previewCanvas = document.getElementById("signaturePreview");
const signatureCanvas = document.getElementById("signaturePad");
const openSignaturePadBtn = document.getElementById("openSignaturePad");
const previewPdfBtn = document.getElementById("previewPdfBtn");
const clearSignatureBtn = document.getElementById("clearSignature");
const closeSignaturePadBtn = document.getElementById("closeSignaturePad");
const cancelModalSignatureBtn = document.getElementById("cancelModalSignature");
const clearModalSignatureBtn = document.getElementById("clearModalSignature");
const saveModalSignatureBtn = document.getElementById("saveModalSignature");
const signatureModal = document.getElementById("signatureModal");
const pdfModal = document.getElementById("pdfModal");
const pdfPreviewFrame = document.getElementById("pdfPreviewFrame");
const closePdfPreviewBtn = document.getElementById("closePdfPreview");
const successModal = document.getElementById("successModal");
const closeSuccessModalBtn = document.getElementById("closeSuccessModal");
const loadingModal = document.getElementById("loadingModal");
const loadingStatus = document.getElementById("loadingStatus");
const toast = document.getElementById("toast");
const summaryNote = document.getElementById("summaryNote");

const company = {
  name: "將御線上理財平臺",
  address: "台中市北區興進路218巷5號",
  email: "jianglaifinance@gmail.com",
};

const depositAmount = 5000;
const previewCtx = previewCanvas.getContext("2d");
const signatureCtx = signatureCanvas.getContext("2d");

let drawing = false;
let hasSignature = false;
let signatureDataUrl = null;
let pdfPreviewUrl = null;
let pdfFontBase64 = null;
let pdfFontLoadingPromise = null;
let isSubmitting = false;
let successCloseTimer = null;
let pdfWarmupTimer = null;
let pdfWarmupPromise = null;
let pdfWarmupFingerprint = null;
let cachedPdfFingerprint = null;
let cachedPdfPackage = null;

function getJsPDF() {
  return window.jspdf?.jsPDF;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

async function loadPdfFont() {
  if (pdfFontBase64) return pdfFontBase64;

  if (!pdfFontLoadingPromise) {
    pdfFontLoadingPromise = fetch("./NotoSansTC-VF.ttf")
      .then((response) => {
        if (!response.ok) {
          throw new Error("中文字型載入失敗");
        }
        return response.arrayBuffer();
      })
      .then((buffer) => {
        pdfFontBase64 = arrayBufferToBase64(buffer);
        return pdfFontBase64;
      });
  }

  return pdfFontLoadingPromise;
}

function pad(num) {
  return String(num).padStart(2, "0");
}

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function receiptNumber() {
  const now = new Date();
  return `RCPT-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function resizeCanvasToDisplaySize(canvas, context) {
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.lineWidth = 2.8;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "#f8fafc";
}

function clearCanvas(context, canvas) {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.restore();
}

function drawDataUrlOnCanvas(canvas, context, dataUrl) {
  clearCanvas(context, canvas);
  if (!dataUrl) return;

  const rect = canvas.getBoundingClientRect();
  const img = new Image();
  img.onload = () => {
    context.drawImage(img, 0, 0, rect.width, rect.height);
  };
  img.src = dataUrl;
}

function syncPreview() {
  resizeCanvasToDisplaySize(previewCanvas, previewCtx);
  drawDataUrlOnCanvas(previewCanvas, previewCtx, signatureDataUrl);
}

function syncSignatureCanvas() {
  const snapshot = signatureCanvas.toDataURL();
  resizeCanvasToDisplaySize(signatureCanvas, signatureCtx);
  if (snapshot && snapshot !== "data:,") {
    drawDataUrlOnCanvas(signatureCanvas, signatureCtx, snapshot);
  } else {
    clearCanvas(signatureCtx, signatureCanvas);
  }
}

function openSignatureModal() {
  signatureModal.classList.add("is-open");
  signatureModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  syncSignatureCanvas();

  if (signatureDataUrl) {
    drawDataUrlOnCanvas(signatureCanvas, signatureCtx, signatureDataUrl);
  }
}

function closeSignatureModal() {
  signatureModal.classList.remove("is-open");
  signatureModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  syncPreview();
}

function commitSignature() {
  signatureDataUrl = signatureCanvas.toDataURL("image/png");
  hasSignature = true;
  syncPreview();
  schedulePdfWarmup();
  closeSignatureModal();
}

function clearAllSignature() {
  signatureDataUrl = null;
  hasSignature = false;
  clearCanvas(signatureCtx, signatureCanvas);
  clearCanvas(previewCtx, previewCanvas);
  invalidatePdfCache();
}

function clearModalOnly() {
  signatureDataUrl = null;
  hasSignature = false;
  clearCanvas(signatureCtx, signatureCanvas);
  clearCanvas(previewCtx, previewCanvas);
  invalidatePdfCache();
}

async function ensurePdfFont(doc) {
  const fontBase64 = await loadPdfFont();
  doc.addFileToVFS("NotoSansTC-VF.ttf", fontBase64);
  doc.addFont("NotoSansTC-VF.ttf", "NotoSansTC", "normal");
  doc.setFont("NotoSansTC", "normal");
}

function getPdfFingerprint(data) {
  return JSON.stringify({
    customerName: data.customerName,
    phone: data.phone,
    birthDate: data.birthDate,
    idNumber: data.idNumber,
    paymentMethod: data.paymentMethod,
    accountNumber: data.accountNumber,
    bankName: data.bankName,
    accountName: data.accountName,
    paymentDate: data.paymentDate,
    paymentNote: data.paymentNote,
    agreed: data.agreed,
    signature: signatureDataUrl || "",
  });
}

function invalidatePdfCache() {
  cachedPdfFingerprint = null;
  cachedPdfPackage = null;
  pdfWarmupPromise = null;
  pdfWarmupFingerprint = null;
  window.clearTimeout(pdfWarmupTimer);
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function createPrintableSignatureDataUrl(dataUrl) {
  if (!dataUrl) return null;

  try {
    const img = await loadImageFromDataUrl(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;

    const context = canvas.getContext("2d");
    context.drawImage(img, 0, 0);

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 0) {
        pixels[i] = 17;
        pixels[i + 1] = 24;
        pixels[i + 2] = 39;
      }
    }
    context.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return dataUrl;
  }
}

function readFormData() {
  const data = new FormData(form);
  return {
    customerName: (data.get("customerName") || "").toString().trim(),
    phone: (data.get("phone") || "").toString().trim(),
    birthDate: (data.get("birthDate") || "").toString().trim(),
    idNumber: (data.get("idNumber") || "").toString().trim(),
    paymentMethod: (data.get("paymentMethod") || "").toString().trim(),
    accountNumber: (data.get("accountNumber") || "").toString().trim(),
    bankName: (data.get("bankName") || "").toString().trim(),
    accountName: (data.get("accountName") || "").toString().trim(),
    paymentDate: (data.get("paymentDate") || "").toString().trim(),
    paymentNote: (data.get("paymentNote") || "").toString().trim(),
    agreed: Boolean(data.get("agreeTerms")),
  };
}

function updateSummary() {
  const data = readFormData();
  summaryNote.textContent = `訂購人：${data.customerName || "尚未填寫"} ｜ 電話：${
    data.phone || "尚未填寫"
  } ｜ 付款方式：${data.paymentMethod || "尚未填寫"}`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2400);
}

function drawText(doc, text, x, y, options = {}) {
  const lines = doc.splitTextToSize(text, options.maxWidth || 170);
  doc.text(lines, x, y);
  return y + lines.length * (options.lineHeight || 6) + (options.gap || 0);
}

function addSectionTitle(doc, title, x, y) {
  doc.setFont("NotoSansTC", "normal");
  doc.setFontSize(12);
  doc.text(title, x, y);
  doc.setDrawColor(180);
  doc.line(x, y + 2, 196, y + 2);
  return y + 8;
}

function drawKeyValue(doc, label, value, x, y, width = 88) {
  doc.setFont("NotoSansTC", "normal");
  doc.setFontSize(10);
  doc.text(label, x, y);
  const lines = doc.splitTextToSize(value || "未填寫", width);
  doc.text(lines, x + 30, y);
  return y + lines.length * 5.5 + 2;
}

async function buildPdf(receiptId = receiptNumber()) {
  const jsPDF = getJsPDF();
  if (!jsPDF) {
    throw new Error("PDF 元件尚未載入");
  }

  const data = readFormData();
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const marginX = 14;
  let y = 16;

  await ensurePdfFont(doc);
  doc.setTextColor(15, 23, 42);
  doc.setFont("NotoSansTC", "normal");
  doc.setFontSize(18);
  doc.text("訂車合約與訂金收據", marginX, y);
  y += 7;

  doc.setFontSize(10);
  y = drawText(doc, `${company.name} ｜ ${company.address}`, marginX, y, {
    maxWidth: 180,
    gap: 2,
  });

  doc.setDrawColor(245, 158, 11);
  doc.setLineWidth(0.6);
  doc.line(marginX, y, 196, y);
  y += 8;

  y = addSectionTitle(doc, "基本資料", marginX, y);
  y = drawKeyValue(doc, "訂購人", data.customerName, marginX, y);
  y = drawKeyValue(doc, "聯絡電話", data.phone, marginX, y);
  y = drawKeyValue(doc, "出生年月日", data.birthDate || "未填寫", marginX, y);
  y = drawKeyValue(doc, "身分證 / 統編", data.idNumber || "未填寫", marginX, y);
  y += 2;

  y = addSectionTitle(doc, "付款資訊", marginX, y);
  y = drawKeyValue(doc, "付款方式", data.paymentMethod, marginX, y);
  y = drawKeyValue(doc, "銀行名稱", data.bankName || "未填寫", marginX, y);
  y = drawKeyValue(doc, "戶名", data.accountName || "未填寫", marginX, y);
  y = drawKeyValue(doc, "帳號 / 後五碼", data.accountNumber || "未填寫", marginX, y);
  y = drawKeyValue(doc, "付款日期", data.paymentDate || todayString(), marginX, y);
  y = drawKeyValue(doc, "付款備註", data.paymentNote || "訂車訂金", marginX, y);
  y += 2;

  y = addSectionTitle(doc, "訂金收據", marginX, y);
  y = drawKeyValue(doc, "收據編號", receiptId, marginX, y);
  y = drawKeyValue(doc, "收據日期", todayString(), marginX, y);
  y = drawKeyValue(doc, "收款單位", company.name, marginX, y);
  y = drawKeyValue(doc, "收款金額", `NT$ ${depositAmount.toLocaleString("zh-TW")}`, marginX, y);
  y = drawKeyValue(doc, "用途", "訂車保留訂金", marginX, y);
  y += 2;

  y = addSectionTitle(doc, "合約條例", marginX, y);
  const terms = [
    "訂購人同意以新台幣 5,000 元作為本次訂車訂金。",
    "訂金支付後，賣方依訂購需求安排配車，實際車輛資訊以配車後確認資料為準。",
    "如訂購人無故取消訂車，訂金原則上不予退還。",
    "如賣方無法依約完成配車或交付車輛，訂購人得請求全額退還訂金。",
    "交車日期如因不可抗力、原廠配車、法規變動或不可歸責於雙方之事由延後，雙方得協議調整。",
    "車輛規格、顏色、配備與交車內容，於配車完成後另行確認並以雙方確認資料為準。",
    "訂購人應提供正確聯絡資料，以便通知交車及相關文件事宜。",
    "本頁為簡易電子簽署範本，正式法律效力建議再由雙方確認或由律師審閱。",
  ];

  doc.setFont("NotoSansTC", "normal");
  doc.setFontSize(10);
  terms.forEach((term, index) => {
    const lines = doc.splitTextToSize(`${index + 1}. ${term}`, 174);
    if (y + lines.length * 5.5 > 258) {
      doc.addPage();
      y = 18;
    }
    doc.text(lines, marginX, y);
    y += lines.length * 5.5 + 1.5;
  });

  if (y + 50 > 270) {
    doc.addPage();
    y = 18;
  }

  y += 3;
  y = addSectionTitle(doc, "電子簽名", marginX, y);
  if (signatureDataUrl) {
    const printableSignature = await createPrintableSignatureDataUrl(signatureDataUrl);
    doc.addImage(printableSignature, "PNG", marginX, y, 90, 36);
    y += 40;
  } else {
    doc.setFont("NotoSansTC", "normal");
    doc.setFontSize(10);
    doc.text("尚未簽名", marginX, y);
    y += 10;
  }

  doc.setFont("NotoSansTC", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`簽署日期：${todayString()}`, marginX, 283);

  return {
    doc,
    receipt: receiptId,
    fileName: `訂車合約_${data.customerName || "未命名"}_${todayString()}.pdf`,
  };
}

async function createPdfPackage(receiptId) {
  const { doc, fileName } = await buildPdf(receiptId);
  const pdfBase64 = doc.output("datauristring").split(",")[1];
  return { fileName, pdfBase64 };
}

async function preparePdfPackage() {
  const data = readFormData();
  const fingerprint = getPdfFingerprint(data);

  if (cachedPdfPackage && cachedPdfFingerprint === fingerprint) {
    return cachedPdfPackage;
  }

  if (pdfWarmupPromise && cachedPdfFingerprint === fingerprint) {
    return pdfWarmupPromise;
  }

  const receiptId = receiptNumber();
  pdfWarmupFingerprint = fingerprint;
  pdfWarmupPromise = createPdfPackage(receiptId).then((pdf) => {
    if (getPdfFingerprint(readFormData()) !== fingerprint) {
      return null;
    }
    cachedPdfFingerprint = fingerprint;
    cachedPdfPackage = { ...pdf, receiptId };
    pdfWarmupPromise = null;
    pdfWarmupFingerprint = null;
    return cachedPdfPackage;
  });

  return pdfWarmupPromise;
}

function schedulePdfWarmup() {
  window.clearTimeout(pdfWarmupTimer);

  const data = readFormData();
  const fingerprint = getPdfFingerprint(data);
  if (!data.customerName || !data.phone || !data.agreed || !signatureDataUrl) {
    invalidatePdfCache();
    return;
  }

  if (pdfWarmupPromise && pdfWarmupFingerprint === fingerprint) {
    return;
  }

  pdfWarmupTimer = window.setTimeout(() => {
    preparePdfPackage().catch((error) => {
      console.warn(error);
    });
  }, 350);
}

async function openPdfPreview() {
  const data = readFormData();
  if (!data.customerName || !data.phone) {
    showToast("請先至少填完姓名與電話才能預覽。");
    return;
  }

  const preparedPdf = await preparePdfPackage();
  const pdf = preparedPdf && preparedPdf.fileName ? preparedPdf : await createPdfPackage(receiptNumber());
  const pdfBlob = base64ToBlob(pdf.pdfBase64, "application/pdf");
  if (pdfPreviewUrl) {
    URL.revokeObjectURL(pdfPreviewUrl);
  }
  pdfPreviewUrl = URL.createObjectURL(pdfBlob);
  pdfPreviewFrame.src = pdfPreviewUrl;
  pdfModal.classList.add("is-open");
  pdfModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closePdfPreview() {
  pdfModal.classList.remove("is-open");
  pdfModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  pdfPreviewFrame.src = "about:blank";
}

function openSuccessModal() {
  window.clearTimeout(successCloseTimer);
  successModal.classList.add("is-open");
  successModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  successCloseTimer = window.setTimeout(() => {
    closeSuccessModal();
  }, 3000);
}

function closeSuccessModal() {
  window.clearTimeout(successCloseTimer);
  successModal.classList.remove("is-open");
  successModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function openLoadingModal() {
  loadingModal.classList.add("is-open");
  loadingModal.setAttribute("aria-hidden", "false");
  if (loadingStatus) {
    loadingStatus.textContent = "請稍候，系統正在產生 PDF 並寄出簽約資料。";
  }
  document.body.style.overflow = "hidden";
}

function closeLoadingModal() {
  loadingModal.classList.remove("is-open");
  loadingModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function setSubmittingState(submitting) {
  isSubmitting = submitting;
  const submitButton = form.querySelector('button[type="submit"]');
  if (!submitButton) return;

  submitButton.disabled = submitting;
  submitButton.dataset.originalLabel ||= submitButton.textContent.trim();
  submitButton.textContent = submitting ? "送出中..." : submitButton.dataset.originalLabel;
}

function setLoadingStep(step) {
  if (loadingStatus) {
    loadingStatus.textContent = step;
  }
}

function base64ToBlob(base64, contentType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: contentType });
}

function positionFromEvent(event) {
  const rect = signatureCanvas.getBoundingClientRect();
  const point = event.touches && event.touches.length > 0 ? event.touches[0] : event;
  return {
    x: point.clientX - rect.left,
    y: point.clientY - rect.top,
  };
}

function startDrawing(event) {
  event.preventDefault();
  drawing = true;
  const { x, y } = positionFromEvent(event);
  signatureCtx.beginPath();
  signatureCtx.moveTo(x, y);
}

function draw(event) {
  if (!drawing) return;
  event.preventDefault();
  const { x, y } = positionFromEvent(event);
  signatureCtx.lineTo(x, y);
  signatureCtx.stroke();
}

function stopDrawing() {
  if (!drawing) return;
  drawing = false;
  hasSignature = true;
}

openSignaturePadBtn.addEventListener("click", openSignatureModal);
previewPdfBtn.addEventListener("click", () => {
  openPdfPreview().catch((error) => {
    console.error(error);
    showToast(error.message || "PDF 預覽失敗");
  });
});
signatureCanvas.addEventListener("pointerdown", startDrawing);
signatureCanvas.addEventListener("pointermove", draw);
signatureCanvas.addEventListener("pointerup", stopDrawing);
signatureCanvas.addEventListener("pointerleave", stopDrawing);
signatureCanvas.addEventListener("pointercancel", stopDrawing);

closeSignaturePadBtn.addEventListener("click", closeSignatureModal);
cancelModalSignatureBtn.addEventListener("click", closeSignatureModal);
clearModalSignatureBtn.addEventListener("click", clearModalOnly);
saveModalSignatureBtn.addEventListener("click", commitSignature);
clearSignatureBtn.addEventListener("click", clearAllSignature);
signatureModal.addEventListener("click", (event) => {
  if (event.target === signatureModal) {
    closeSignatureModal();
  }
});

pdfModal.addEventListener("click", (event) => {
  if (event.target === pdfModal) {
    closePdfPreview();
  }
});

closePdfPreviewBtn.addEventListener("click", closePdfPreview);
closeSuccessModalBtn.addEventListener("click", closeSuccessModal);
loadingModal.addEventListener("click", (event) => {
  if (event.target === loadingModal) {
    event.preventDefault();
  }
});

window.addEventListener("resize", () => {
  syncPreview();
  if (signatureModal.classList.contains("is-open")) {
    syncSignatureCanvas();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && signatureModal.classList.contains("is-open")) {
    closeSignatureModal();
  } else if (event.key === "Escape" && pdfModal.classList.contains("is-open")) {
    closePdfPreview();
  } else if (event.key === "Escape" && successModal.classList.contains("is-open")) {
    closeSuccessModal();
  }
});

form.addEventListener("input", () => {
  updateSummary();
  schedulePdfWarmup();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isSubmitting) {
    return;
  }

  const data = readFormData();

  if (!data.customerName || !data.phone) {
    showToast("請先填寫姓名與電話。");
    return;
  }

  if (!data.agreed) {
    showToast("請先勾選同意條例。");
    return;
  }

  if (!signatureDataUrl) {
    showToast("請先完成簽名。");
    return;
  }

  const receiptId = receiptNumber();
  setSubmittingState(true);
  openLoadingModal();

  try {
    setLoadingStep("PDF 產生中，請稍候...");
    const cachedPdf = await preparePdfPackage();
    const pdf = cachedPdf && cachedPdf.receiptId ? cachedPdf : await createPdfPackage(receiptId);
    const finalReceiptId = pdf.receiptId || receiptId;
    setLoadingStep("資料寄送中，請稍候...");
    const requestController = new AbortController();
    const requestTimeout = window.setTimeout(() => {
      requestController.abort();
    }, 20000);

    let response;
    try {
      const payload = {
        ...data,
        deposit: `NT$ ${depositAmount.toLocaleString("zh-TW")}`,
        receiptNumber: finalReceiptId,
        company,
        fileName: pdf.fileName,
        signature: signatureDataUrl,
      };

      localStorage.setItem("carReservationContract", JSON.stringify(payload));

      response = await fetch("/api/send-contract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: requestController.signal,
        body: JSON.stringify({
          ...data,
          fileName: pdf.fileName,
          receiptNumber: finalReceiptId,
          pdfBase64: pdf.pdfBase64,
          signature: signatureDataUrl,
          company,
          deposit: `NT$ ${depositAmount.toLocaleString("zh-TW")}`,
        }),
      });
    } finally {
      window.clearTimeout(requestTimeout);
    }

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || "寄信失敗");
    }

    if (pdfModal.classList.contains("is-open")) {
      closePdfPreview();
    }
    closeLoadingModal();
    openSuccessModal();
    invalidatePdfCache();
    if (pdfPreviewUrl) {
      URL.revokeObjectURL(pdfPreviewUrl);
      pdfPreviewUrl = null;
    }
  } catch (error) {
    closeLoadingModal();
    console.error(error);
    if (error?.name === "AbortError") {
      showToast("送出逾時，請再試一次");
    } else {
      showToast(error.message || "寄信失敗，請稍後再試");
    }
  } finally {
    setSubmittingState(false);
  }
});

syncPreview();
loadPdfFont().catch((error) => console.warn(error));
form.querySelector('input[name="paymentDate"]').value = todayString();
form.querySelector('input[name="paymentNote"]').value = "訂車訂金";
updateSummary();
schedulePdfWarmup();
