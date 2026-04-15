import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";

const PORT = Number(process.env.PORT || 3000);
const ROOT = process.cwd();
const PUBLIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/app.js", "app.js"],
  ["/styles.css", "styles.css"],
  ["/NotoSansTC-VF.ttf", "NotoSansTC-VF.ttf"],
]);

function getPathname(reqUrl) {
  return new URL(reqUrl, `http://localhost:${PORT}`).pathname;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function extToType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

async function serveStatic(req, res) {
  const fileName = PUBLIC_FILES.get(getPathname(req.url));
  if (!fileName) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const filePath = path.join(ROOT, fileName);
  const content = await fs.readFile(filePath);
  res.writeHead(200, {
    "Content-Type": extToType(fileName),
    "Cache-Control": "no-store",
  });
  res.end(content);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 15 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function createTransport() {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = (process.env.SMTP_SECURE || "true").toLowerCase() === "true";
  const user = requireEnv("SMTP_USER");
  const pass = requireEnv("SMTP_PASS");

  return nodemailer.createTransport({
    host,
    port,
    secure,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 12000,
    auth: { user, pass },
  });
}

function buildContractText(body) {
  return [
    "您好，",
    "",
    "附件為訂車合約與訂金收據 PDF。",
    `訂購人：${body.customerName}`,
    `聯絡電話：${body.phone}`,
    `出生年月日：${body.birthDate || "未填寫"}`,
    `身分證 / 統編：${body.idNumber || "未填寫"}`,
    `付款方式：${body.paymentMethod || "未填寫"}`,
    `訂金：${body.deposit || "NT$ 5,000"}`,
    `收據編號：${body.receiptNumber || "未填寫"}`,
    "",
    "如需更正資料，請直接回覆此信。",
  ].join("\n");
}

async function sendTelegramContract(body, pdfBuffer) {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const chatId = requireEnv("TELEGRAM_CHAT_ID");
  const caption = buildContractText(body);
  const url = `https://api.telegram.org/bot${token}/sendDocument`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption);
  form.append("disable_notification", "false");
  form.append("document", new Blob([pdfBuffer], { type: "application/pdf" }), body.fileName);

  try {
    const response = await fetch(url, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Telegram 寄送失敗${text ? `：${text}` : ""}`);
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Telegram 寄送逾時");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(label)), ms);
    }),
  ]);
}

async function handleSendContract(req, res) {
  const body = await parseJsonBody(req);
  const required = ["customerName", "phone", "pdfBase64", "fileName"];
  const missing = required.filter((key) => !body[key]);
  if (missing.length > 0) {
    sendJson(res, 400, { ok: false, error: `Missing fields: ${missing.join(", ")}` });
    return;
  }

  const recipient = process.env.CONTRACT_RECIPIENT || "jianglaifinance@gmail.com";
  const from = requireEnv("SMTP_USER");
  const transport = createTransport();
  const pdfBuffer = Buffer.from(body.pdfBase64, "base64");
  const mailText = buildContractText(body);

  const [mailResult, telegramResult] = await Promise.allSettled([
    withTimeout(
      transport.sendMail({
        from: `將御線上理財平臺 <${from}>`,
        to: recipient,
        subject: `訂車合約與訂金收據 - ${body.customerName}`,
        text: mailText,
        attachments: [
          {
            filename: body.fileName,
            content: pdfBuffer,
            contentType: "application/pdf",
          },
        ],
      }),
      15000,
      "Gmail 寄送逾時",
    ),
    withTimeout(sendTelegramContract(body, pdfBuffer), 15000, "Telegram 寄送逾時"),
  ]);

  const failures = [];
  if (mailResult.status === "rejected") {
    failures.push(`Gmail：${mailResult.reason?.message || mailResult.reason || "寄送失敗"}`);
  }
  if (telegramResult.status === "rejected") {
    failures.push(`Telegram：${telegramResult.reason?.message || telegramResult.reason || "寄送失敗"}`);
  }

  if (failures.length > 0) {
    throw new Error(failures.join("；"));
  }

  sendJson(res, 200, { ok: true });
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = getPathname(req.url);

    if (req.method === "POST" && pathname === "/api/send-contract") {
      await handleSendContract(req, res);
      return;
    }

    if (req.method === "GET" && PUBLIC_FILES.has(pathname)) {
      await serveStatic(req, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { ok: false, error: error.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
