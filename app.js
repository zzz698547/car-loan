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
const toast = document.getElementById("toast");
const summaryNote = document.getElementById("summaryNote");

const company = {
  name: "御線上理財平臺",
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

function getJsPDF() {
  return window.jspdf?.jsPDF;
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
  closeSignatureModal();
}

function clearAllSignature() {
  signatureDataUrl = null;
  hasSignature = false;
  clearCanvas(signatureCtx, signatureCanvas);
  clearCanvas(previewCtx, previewCanvas);
}

function clearModalOnly() {
  signatureDataUrl = null;
  hasSignature = false;
  clearCanvas(signatureCtx, signatureCanvas);
  clearCanvas(previewCtx, previewCanvas);
}

function openPdfPreview() {
  const data = readFormData();
  if (!data.customerName || !data.phone || !data.deliveryDate || !data.email) {
    showToast("請先至少填完姓名、電話、交車日期與 Email 才能預覽。");
    return;
  }

  const receiptId = receiptNumber();
  const pdf = createPdfPackage(receiptId);
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

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2400);
}

function readFormData() {
  const data = new FormData(form);
  return {
    customerName: (data.get("customerName") || "").toString().trim(),
    phone: (data.get("phone") || "").toString().trim(),
    idNumber: (data.get("idNumber") || "").toString().trim(),
    deliveryDate: (data.get("deliveryDate") || "").toString().trim(),
    email: (data.get("email") || "").toString().trim(),
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
  summaryNote.textContent = `訂購人：${data.customerName || "尚未填寫"} ｜ 交車：${
    data.deliveryDate || "尚未填寫"
  } ｜ 收件：${data.email || "尚未填寫"}`;
}

function drawText(doc, text, x, y, options = {}) {
  const lines = doc.splitTextToSize(text, options.maxWidth || 170);
  doc.text(lines, x, y);
  return y + lines.length * (options.lineHeight || 6) + (options.gap || 0);
}

function addSectionTitle(doc, title, x, y) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(title, x, y);
  doc.setDrawColor(180);
  doc.line(x, y + 2, 196, y + 2);
  return y + 8;
}

function drawKeyValue(doc, label, value, x, y, width = 88) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(label, x, y);
  doc.setFont("helvetica", "normal");
  const lines = doc.splitTextToSize(value || "未填寫", width);
  doc.text(lines, x + 28, y);
  return y + lines.length * 5.5 + 2;
}

function buildPdf(receiptId = receiptNumber()) {
  const jsPDF = getJsPDF();
  if (!jsPDF) {
    throw new Error("PDF 元件尚未載入");
  }

  const data = readFormData();
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const marginX = 14;
  let y = 16;

  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("訂車合約與訂金收據", marginX, y);
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  y = drawText(doc, `${company.name} ｜ ${company.address}`, marginX, y, { maxWidth: 180, gap: 2 });

  doc.setDrawColor(245, 158, 11);
  doc.setLineWidth(0.6);
  doc.line(marginX, y, 196, y);
  y += 8;

  y = addSectionTitle(doc, "基本資料", marginX, y);
  y = drawKeyValue(doc, "訂購人", data.customerName, marginX, y);
  y = drawKeyValue(doc, "聯絡電話", data.phone, marginX, y);
  y = drawKeyValue(doc, "身分證 / 統編", data.idNumber || "未填寫", marginX, y);
  y = drawKeyValue(doc, "預定交車", data.deliveryDate, marginX, y);
  y = drawKeyValue(doc, "收件 Email", data.email, marginX, y);
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

  doc.setFont("helvetica", "normal");
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
    doc.addImage(signatureDataUrl, "PNG", marginX, y, 90, 36);
    y += 40;
  } else {
    doc.setFont("helvetica", "italic");
    doc.text("尚未簽名", marginX, y);
    y += 10;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`簽署日期：${todayString()}`, marginX, 283);

  return { doc, receipt: receiptId, fileName: `訂車合約_${data.customerName || "未命名"}_${todayString()}.pdf` };
}

function downloadPdf(receiptId) {
  const { doc, fileName } = buildPdf(receiptId);
  doc.save(fileName);
  return { fileName, receiptId: receiptId || "UNKNOWN" };
}

function createPdfPackage(receiptId) {
  const { doc, fileName } = buildPdf(receiptId);
  const pdfBase64 = doc.output("datauristring").split(",")[1];
  return { fileName, pdfBase64 };
}

function openGmailDraft(data, receiptId) {
  const subject = `訂車合約與訂金收據 - ${data.customerName || "未命名"}`;
  const body = [
    `您好，`,
    "",
    `以下為訂車合約與訂金收據資訊：`,
    `訂購人：${data.customerName || "未填寫"}`,
    `訂金：NT$ ${depositAmount.toLocaleString("zh-TW")}`,
    `收據編號：${receiptId || "未填寫"}`,
    "",
    `PDF 已另外下載，請將附件加入此封 Gmail 草稿後送出。`,
  ].join("\n");
  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
    company.email,
  )}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.open(gmailUrl, "_blank", "noopener,noreferrer");
}

openSignaturePadBtn.addEventListener("click", openSignatureModal);
previewCanvas.addEventListener("click", openSignatureModal);
signatureCanvas.addEventListener("pointerdown", startDrawing);
signatureCanvas.addEventListener("pointermove", draw);
signatureCanvas.addEventListener("pointerup", stopDrawing);
signatureCanvas.addEventListener("pointerleave", stopDrawing);

closeSignaturePadBtn.addEventListener("click", closeSignatureModal);
cancelModalSignatureBtn.addEventListener("click", closeSignatureModal);
clearModalSignatureBtn.addEventListener("click", clearModalOnly);
saveModalSignatureBtn.addEventListener("click", commitSignature);
clearSignatureBtn.addEventListener("click", clearAllSignature);
previewPdfBtn.addEventListener("click", openPdfPreview);
closePdfPreviewBtn.addEventListener("click", closePdfPreview);
pdfModal.addEventListener("click", (event) => {
  if (event.target === pdfModal) {
    closePdfPreview();
  }
});
signatureModal.addEventListener("click", (event) => {
  if (event.target === signatureModal) {
    closeSignatureModal();
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
  }
});

form.addEventListener("input", updateSummary);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = readFormData();

  if (!data.customerName || !data.phone || !data.deliveryDate || !data.email) {
    showToast("請先填寫姓名、電話、交車日期與收件 Email。");
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
  const pdf = createPdfPackage(receiptId);
  const payload = {
    ...data,
    deposit: `NT$ ${depositAmount.toLocaleString("zh-TW")}`,
    receiptNumber: receiptId,
    company,
    fileName: pdf.fileName,
    signature: signatureDataUrl,
  };

  localStorage.setItem("carReservationContract", JSON.stringify(payload));

  try {
    const response = await fetch("/api/send-contract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...data,
        fileName: pdf.fileName,
        receiptNumber: receiptId,
        pdfBase64: pdf.pdfBase64,
        signature: signatureDataUrl,
        company,
        deposit: `NT$ ${depositAmount.toLocaleString("zh-TW")}`,
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || "寄信失敗");
    }

    alert("簽約成功");
    if (pdfPreviewUrl) {
      URL.revokeObjectURL(pdfPreviewUrl);
      pdfPreviewUrl = null;
    }
  } catch (error) {
    console.error(error);
    showToast(error.message || "寄信失敗，請稍後再試。");
  }
});

syncPreview();
form.querySelector('input[name="paymentDate"]').value = todayString();
form.querySelector('input[name="paymentNote"]').value = "訂車訂金";
form.querySelector('select[name="paymentMethod"]').value = "銀行轉帳";
updateSummary();
