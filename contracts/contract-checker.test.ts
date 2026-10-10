/** ตัวตรวจสัญญาต้องจับ request/response ที่ผิดได้จริง (feat-038 gate: response ผิด schema → เทสต์ fail) */
import { describe, expect, it } from "vitest";
import { cafeLayout } from "@/test/fixtures/layouts";
import { validateLayout } from "@/core/validation";
import { contractFetch } from "./contract-checker";

const layout = cafeLayout();
const stored = { layout, validation: validateLayout(layout), createdAt: "2026-10-10T06:00:00.000Z", updatedAt: "2026-10-10T06:00:00.000Z" };
const headers = { authorization: "Bearer t", "x-request-id": "0f8fad5b-d9cb-469f-a165-70867728950e" };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });

async function violationsOf(response: Response, init: RequestInit & { url?: string } = {}) {
  const checked = contractFetch(() => response);
  await checked.fetch(init.url ?? "http://be.test/v1/layouts/a", { headers, ...init });
  return checked.violations.map((v) => `${v.where}: ${v.message}`);
}

describe("contractFetch", () => {
  it("คำขอและคำตอบที่ถูกต้อง → ไม่มี violation", async () => {
    expect(await violationsOf(json(stored))).toEqual([]);
  });

  it("response มีฟิลด์เกิน / ขาดฟิลด์ → ผิด schema", async () => {
    expect((await violationsOf(json({ ...stored, ownerId: "x" })))[0]).toMatch(/response: สถานะ 200 body ผิด schema/);
    const missing = Object.fromEntries(Object.entries(stored).filter(([k]) => k !== "updatedAt"));
    expect((await violationsOf(json(missing)))[0]).toMatch(/updatedAt/);
  });

  it("สถานะที่ไม่อยู่ในสัญญา → violation", async () => {
    expect(await violationsOf(json({ error: { code: "NOT_FOUND", message: "x" } }, 403))).toEqual([
      expect.stringMatching(/สถานะ 403 ไม่อยู่ในสัญญา/),
    ]);
  });

  it("error code ที่ไม่รู้จัก และ 429 ที่ไม่มี Retry-After → violation", async () => {
    expect((await violationsOf(json({ error: { code: "OOPS", message: "x" } }, 404)))[0]).toMatch(/body ผิด schema/);
    expect(await violationsOf(json({ error: { code: "RATE_LIMITED", message: "x", retryAfter: 5 } }, 429))).toEqual([
      expect.stringMatching(/ต้องมี header Retry-After/),
    ]);
  });

  it("DELETE ตอบ 200 (สัญญากำหนด 204) → violation", async () => {
    expect(await violationsOf(new Response("{}", { status: 200 }), { method: "DELETE" })).toEqual([
      expect.stringMatching(/สถานะ 200 ไม่อยู่ในสัญญา/),
    ]);
  });

  it("request: ไม่มี token / ไม่มี X-Request-Id / body ผิด / path ไม่มีในสัญญา", async () => {
    expect(await violationsOf(json(stored), { headers: {} })).toEqual([
      "request: ไม่มี Authorization: Bearer",
      "request: ไม่มี header X-Request-Id",
    ]);
    const put = await violationsOf(json(stored), {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ layout, validation: stored.validation }),
    });
    expect(put[0]).toMatch(/request: body ผิด schema/);
    expect(await violationsOf(json({}), { url: "http://be.test/v1/unknown" })).toEqual(["request: ไม่มี operation นี้ในสัญญา"]);
  });

  it("endpoint anonymous ต้องส่ง X-Client-IP", async () => {
    const res = json({ id: "1", receivedAt: "2026-10-10T06:00:00.000Z" }, 202);
    const v = await violationsOf(res, {
      url: "http://be.test/v1/contact-messages",
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "a", email: "a@b.co", message: "1234567890" }),
    });
    expect(v).toEqual(["request: ไม่มี header X-Client-IP"]);
  });
});
