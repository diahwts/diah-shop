#!/usr/bin/env node
// Tự động lấy danh sách sản phẩm mới nhất từ Apps Script và "nhúng" (embed) thẳng vào
// index.html giữa 2 mốc <!-- SNAPSHOT-PRODUCTS-START --> ... <!-- SNAPSHOT-PRODUCTS-END -->.
// Mục đích: khách vào web LẦN ĐẦU (chưa có bộ nhớ tạm/localStorage) sẽ thấy sản phẩm NGAY LẬP
// TỨC thay vì màn hình trống chờ gọi API. Dữ liệu nhúng này chỉ là "ảnh chụp tạm" — trang web
// vẫn luôn gọi API thật ngay sau đó để lấy tồn kho/giá chính xác nhất (xem index.html, hàm
// restoreEmbeddedSnapshot + initApp). Vì vậy script này CHẠY ĐỊNH KỲ (xem
// .github/workflows/update-snapshot.yml) chứ không cần đúng 100% thời gian thực.
//
// Chạy thủ công: node scripts/generate-snapshot.mjs

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML_PATH = path.join(__dirname, "..", "index.html");
const START_MARKER = "<!-- SNAPSHOT-PRODUCTS-START";
const END_MARKER = "<!-- SNAPSHOT-PRODUCTS-END -->";

function extractConst(html, name) {
  const match = html.match(new RegExp(`const ${name}\\s*=\\s*"([^"]+)"`));
  if (!match) throw new Error(`Không tìm thấy hằng số ${name} trong index.html`);
  return match[1];
}

async function fetchProducts(appsScriptUrl) {
  const url = `${appsScriptUrl}?action=products&ts=${Date.now()}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Gọi API thất bại: HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload && payload.retry) {
    throw new Error("Backend đang bận (retry:true) — thử lại sau.");
  }
  if (!payload || payload.ok === false) {
    throw new Error("API trả lỗi: " + JSON.stringify(payload).slice(0, 300));
  }
  const products = Array.isArray(payload.products) ? payload.products : [];
  const promotions = Array.isArray(payload.promotions) ? payload.promotions : [];
  if (!products.length) {
    throw new Error("API trả về danh sách sản phẩm rỗng — không ghi đè snapshot để tránh mất dữ liệu.");
  }
  return { products, promotions };
}

async function main() {
  const html = await readFile(INDEX_HTML_PATH, "utf8");
  const appsScriptUrl = extractConst(html, "APPS_SCRIPT_URL");

  const startIdx = html.indexOf(START_MARKER);
  const endIdx = html.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error("Không tìm thấy marker SNAPSHOT-PRODUCTS-START/END trong index.html");
  }

  const { products, promotions } = await fetchProducts(appsScriptUrl);
  const snapshot = {
    products,
    promotions,
    generatedAt: new Date().toISOString(),
  };

  const block =
    START_MARKER + ": KHÔNG SỬA TAY — được GitHub Action tự động ghi đè mỗi khi -->\n" +
    "  <!-- sản phẩm/tồn kho thay đổi (xem .github/workflows/update-snapshot.yml). Nội dung này chỉ -->\n" +
    "  <!-- dùng để hiện sản phẩm NGAY khi khách vào web lần đầu, luôn được ghi đè bằng dữ liệu thật -->\n" +
    "  <!-- ngay sau đó qua loadProducts(). -->\n" +
    `  <script type="application/json" id="initialProductsData">${JSON.stringify(snapshot)}</script>\n` +
    "  " + END_MARKER;

  const before = html.slice(0, startIdx);
  const after = html.slice(endIdx + END_MARKER.length);
  const nextHtml = before + block + after;

  if (nextHtml === html) {
    console.log("Snapshot không đổi — bỏ qua ghi file.");
    return;
  }

  await writeFile(INDEX_HTML_PATH, nextHtml, "utf8");
  console.log(`Đã cập nhật snapshot: ${products.length} sản phẩm, lúc ${snapshot.generatedAt}`);
}

main().catch((error) => {
  console.error("Lỗi tạo snapshot:", error.message);
  process.exit(1);
});
