/**
 * Contract test (feat-036) — contracts/openapi.yaml ต้องตรงกับ Zod schema ที่ BFF/Core ใช้จริง
 * ถ้าแก้ src/core/validation/layout.schema.ts หรือ src/lib/contact-schema.ts แล้วเทสต์นี้ fail = ต้องอัปเดตสัญญา (และแจ้งฝั่ง Backend)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { StoreLayout } from "@/core/layout";
import { StoreLayoutSchema, validateLayout } from "@/core/validation";
import { ContactSchema } from "@/lib/contact-schema";
import { LAYOUT_LIMIT, SHARE_LIMIT, SHARE_MAX_DAYS } from "@/server/limits";
import { cafeLayout } from "@/test/fixtures/layouts";

type Operation = {
  operationId: string;
  security?: unknown[];
  parameters?: Array<{ $ref?: string }>;
  responses: Record<string, unknown>;
  "x-allow-anonymous"?: boolean;
};
type PathItem = { parameters?: Array<{ $ref?: string }> } & Record<string, unknown>;

const spec = parse(readFileSync(resolve(__dirname, "openapi.yaml"), "utf8")) as {
  paths: Record<string, PathItem>;
  components: { schemas: Record<string, unknown> };
};

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: "openapi", components: spec.components });
const schema = (name: string) => {
  const validate = ajv.getSchema(`openapi#/components/schemas/${name}`);
  if (!validate) throw new Error(`ไม่พบ schema ${name}`);
  return validate;
};

const METHODS = ["get", "put", "post", "patch", "delete"] as const;
const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
  METHODS.filter((m) => item[m]).map((method) => ({ path, method, item, op: item[method] as Operation })),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- เทสต์จงใจสร้างผังผิดรูปแบบ จึงต้องเขียนทับฟิลด์ได้อิสระ
type Loose = Record<string, any>;

/** แก้ผังด้วย mutate แล้วคืนสำเนา (ไม่แตะ fixture) */
function mutated(mutate: (layout: Loose) => void): unknown {
  const copy = structuredClone(cafeLayout()) as unknown as Loose;
  mutate(copy);
  return copy;
}
const firstOf = (layout: Loose, type: string) => layout.objects.find((o: { type: string }) => o.type === type);

describe("โครงสร้างสัญญา", () => {
  it("มีครบทุก operation ที่ BFF ต้องใช้", () => {
    expect(operations.map((o) => o.op.operationId).sort()).toEqual(
      [
        "createContactMessage",
        "createLayout",
        "createShare",
        "deleteLayout",
        "deleteMe",
        "exportMe",
        "getHealth",
        "getLayout",
        "getMe",
        "getPublicShare",
        "listLayouts",
        "listShares",
        "mergeGuest",
        "revokeShare",
        "updateLayout",
        "updateShare",
        "upsertMe",
      ].sort(),
    );
  });

  it("ทุก endpoint (ยกเว้น /health) อยู่ใต้ /v1, ต้องมี token, ตอบ 401 และ 5XX ได้ และรับ X-Request-Id", () => {
    for (const { path, item, op } of operations.filter((o) => o.path !== "/health")) {
      expect(path, op.operationId).toMatch(/^\/v1\//);
      expect(op.security, op.operationId).toBeUndefined(); // ใช้ security ระดับเอกสาร (internalToken)
      expect(Object.keys(op.responses), op.operationId).toContain("401");
      expect(Object.keys(op.responses), op.operationId).toContain("5XX"); // Backend ล่มได้ทุก endpoint
      const params = [...(item.parameters ?? []), ...(op.parameters ?? [])].map((p) => p.$ref);
      expect(params, op.operationId).toContain("#/components/parameters/RequestId");
    }
  });

  it("anonymous ใช้ได้เฉพาะเปิดลิงก์แชร์และส่งฟอร์มติดต่อ", () => {
    expect(operations.filter((o) => o.op["x-allow-anonymous"]).map((o) => o.op.operationId).sort()).toEqual([
      "createContactMessage",
      "getPublicShare",
    ]);
  });

  it("ตัวเลขโควตาในสัญญาตรงกับ src/server/limits.ts (ข้อความไทยของ BFF และ Backend จำลองใช้ค่าเดียวกัน)", () => {
    const text = readFileSync(resolve(__dirname, "openapi.yaml"), "utf8");
    const list = spec.paths["/v1/layouts"]!.get as unknown as { responses: { "200": { content: { "application/json": { schema: { properties: { layouts: { maxItems: number } } } } } } } };
    expect(list.responses["200"].content["application/json"].schema.properties.layouts.maxItems).toBe(LAYOUT_LIMIT);
    expect(text).toContain(`ผู้ใช้มีผังครบ ${LAYOUT_LIMIT} ผังแล้ว`);
    expect(text).toContain(`ลิงก์ที่ยังใช้งานได้ต่อผังสูงสุด ${SHARE_LIMIT} ลิงก์`);
    expect(text).toContain(`ไม่เกิน ${SHARE_MAX_DAYS} วันจากตอนนี้`);
  });

  it("/health ไม่ต้องใช้ token", () => {
    expect(operations.find((o) => o.op.operationId === "getHealth")!.op.security).toEqual([]);
  });
});

describe("StoreLayout ตรงกับ StoreLayoutSchema (Zod)", () => {
  const openapi = schema("StoreLayout");
  const zodAccepts = (value: unknown) => StoreLayoutSchema.safeParse(value).success;

  it("ผัง Ready จาก fixture ผ่านทั้งสองฝั่ง", () => {
    const layout = cafeLayout();
    expect(zodAccepts(layout)).toBe(true);
    expect(openapi(layout), JSON.stringify(openapi.errors)).toBe(true);
  });

  it.each<[string, (l: Loose) => void]>([
    ["ยังไม่มีทางเข้า (entrance: null)", (l) => (l.entrance = null)],
    ["โต๊ะไม่มีเก้าอี้ (chairIds: [])", (l) => (firstOf(l, "table").chairIds = [])],
    ["โต๊ะไม่มี preset", (l) => delete firstOf(l, "table").preset],
    ["วัตถุออกนอกร้านชั่วคราว (x ติดลบ)", (l) => (firstOf(l, "kitchen").x = -1)],
    ["ไม่มีวัตถุเลย", (l) => (l.objects = [])],
  ])("ยอมรับทั้งสองฝั่ง: %s", (_, mutate) => {
    const value = mutated(mutate);
    expect(zodAccepts(value)).toBe(true);
    expect(openapi(value), JSON.stringify(openapi.errors)).toBe(true);
  });

  it.each<[string, (l: Loose) => void]>([
    ["หมุน 45°", (l) => (firstOf(l, "counter").rotation = 45)],
    ["ขนาดร้านไม่ลงกริด 0.25", (l) => (l.width = 8.1)],
    ["ร้านกว้างเกิน 30 ม.", (l) => (l.width = 30.25)],
    ["ร้านเล็กกว่า 2 ม.", (l) => (l.depth = 1.75)],
    ["หน่วยไม่ใช่เมตร", (l) => (l.units = "cm")],
    ["version = 0", (l) => (l.version = 0)],
    ["version ไม่ใช่จำนวนเต็ม", (l) => (l.version = 1.5)],
    ["ฟิลด์เกินที่ root", (l) => (l.name = "ร้านกาแฟ")],
    ["ฟิลด์เกินที่วัตถุ", (l) => (firstOf(l, "kitchen").color = "red")],
    ["ชนิดวัตถุ shelf (ไม่มีใน V1)", (l) => (firstOf(l, "counter").type = "shelf")],
    ["เก้าอี้ไม่มี tableId", (l) => delete firstOf(l, "chair").tableId],
    ["โต๊ะไม่มี chairIds", (l) => delete firstOf(l, "table").chairIds],
    ["preset ไม่รู้จัก", (l) => (firstOf(l, "table").preset = "table-6-seats")],
    ["เก้าอี้เกิน 16 ตัวต่อโต๊ะ", (l) => (firstOf(l, "table").chairIds = Array.from({ length: 17 }, (_, i) => `c${i}`))],
    ["ขนาดวัตถุเป็น 0", (l) => (firstOf(l, "kitchen").width = 0)],
    ["ขนาดวัตถุเกิน 30 ม.", (l) => (firstOf(l, "kitchen").depth = 31)],
    ["พิกัดไกลเกินขอบเขต", (l) => (firstOf(l, "kitchen").x = 61)],
    ["พิกัดติดลบเกิน -30", (l) => (firstOf(l, "kitchen").y = -31)],
    ["ทางเข้าแคบกว่า 0.6 ม.", (l) => (l.entrance.width = 0.5)],
    ["ทางเข้ากว้างเกิน 3 ม.", (l) => (l.entrance.width = 3.25)],
    ["ผนังทางเข้าไม่รู้จัก", (l) => (l.entrance.wall = "up")],
    ["id ว่าง", (l) => (l.id = "")],
    ["id ยาวเกิน 128", (l) => (l.id = "x".repeat(129))],
    ["วัตถุเกิน 1000 ชิ้น", (l) => (l.objects = Array.from({ length: 1001 }, () => firstOf(l, "kitchen")))],
  ])("ปฏิเสธทั้งสองฝั่ง: %s", (_, mutate) => {
    const value = mutated(mutate);
    expect(zodAccepts(value)).toBe(false);
    expect(openapi(value)).toBe(false);
  });

  it("ช่องว่างที่รู้อยู่แล้ว: id วัตถุซ้ำ — Zod ปฏิเสธ แต่ JSON Schema ตรวจไม่ได้ (Backend ต้องใช้ StoreLayoutSchema)", () => {
    const value = mutated((l) => (firstOf(l, "counter").id = firstOf(l, "kitchen").id));
    expect(zodAccepts(value)).toBe(false);
    expect(openapi(value)).toBe(true);
  });
});

describe("ผลตรวจและ response ของผัง", () => {
  const layout: StoreLayout = cafeLayout();
  const validation = validateLayout(layout);
  const at = "2026-10-10T06:00:00.000Z";

  it("ValidationResult จาก validateLayout() ผ่าน schema — ทั้งผัง Ready และผัง Blocked", () => {
    expect(schema("ValidationResult")(validation)).toBe(true);
    const blocked = validateLayout({ ...layout, entrance: null });
    expect(blocked.status).toBe("blocked");
    expect(schema("ValidationResult")(blocked)).toBe(true);
  });

  it("StoredLayout / LayoutSummary / PublicShare", () => {
    expect(schema("StoredLayout")({ layout, validation, createdAt: at, updatedAt: at })).toBe(true);
    expect(
      schema("LayoutSummary")({ id: layout.id, width: layout.width, depth: layout.depth, objectCount: layout.objects.length, status: validation.status, updatedAt: at }),
    ).toBe(true);
    expect(schema("PublicShare")({ layout, validation, createdAt: at, expiresAt: null })).toBe(true);
    // PublicShare ห้ามเปิดเผยเจ้าของ
    expect(schema("PublicShare")({ layout, validation, createdAt: at, expiresAt: null, ownerId: "guest-1" })).toBe(false);
  });

  it("SaveLayoutRequest รับแค่ { layout } — ผลตรวจ Backend คำนวณเอง", () => {
    expect(schema("SaveLayoutRequest")({ layout })).toBe(true);
    expect(schema("SaveLayoutRequest")({ layout, validation })).toBe(false);
  });

  it("Error ของผัง Blocked แนบ validation และ issues ได้", () => {
    const blocked = validateLayout({ ...layout, entrance: null });
    const body = {
      error: { code: "LAYOUT_BLOCKED", message: "blocked", validation: blocked, issues: blocked.issues.filter((i) => i.severity === "blocked") },
    };
    expect(schema("Error")(body)).toBe(true);
    expect(schema("Error")({ error: { code: "SOMETHING_NEW", message: "x" } })).toBe(false);
  });
});

describe("ลิงก์แชร์", () => {
  const key = "A".repeat(43);
  const at = "2026-10-10T06:00:00.000Z";

  it("ShareLink ทั้งแบบไม่หมดอายุและแบบยกเลิกแล้ว", () => {
    const base = { shareKey: key, layoutId: "layout-1", createdAt: at, expiresAt: null, revokedAt: null, status: "active" };
    expect(schema("ShareLink")(base)).toBe(true);
    expect(schema("ShareLink")({ ...base, revokedAt: at, status: "revoked" })).toBe(true);
    expect(schema("ShareLink")({ ...base, shareKey: "short" })).toBe(false);
  });

  it("CreateShareRequest: body ว่าง = ไม่หมดอายุ", () => {
    expect(schema("CreateShareRequest")({})).toBe(true);
    expect(schema("CreateShareRequest")({ expiresAt: at })).toBe(true);
    expect(schema("CreateShareRequest")({ expiresAt: "พรุ่งนี้" })).toBe(false);
  });
});

describe("ContactMessageRequest ตรงกับ ContactSchema (ไม่รวม honeypot)", () => {
  const valid = { name: "สมชาย", email: "somchai@example.com", message: "สนใจใช้กับร้านกาแฟ 3 สาขา" };

  it("ข้อความถูกต้องผ่านทั้งสองฝั่ง", () => {
    expect(ContactSchema.safeParse(valid).success).toBe(true);
    expect(schema("ContactMessageRequest")(valid)).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ["ไม่มีชื่อ", { name: "" }],
    ["ชื่อยาวเกิน 80", { name: "ก".repeat(81) }],
    ["อีเมลผิดรูปแบบ", { email: "not-an-email" }],
    ["ข้อความสั้นกว่า 10 ตัวอักษร", { message: "สั้นไป" }],
    ["ข้อความยาวเกิน 2000", { message: "ก".repeat(2001) }],
    ["ฟิลด์เกิน", { phone: "0812345678" }],
  ])("ปฏิเสธทั้งสองฝั่ง: %s", (_, patch) => {
    const value = { ...valid, ...patch };
    expect(ContactSchema.safeParse(value).success).toBe(false);
    expect(schema("ContactMessageRequest")(value)).toBe(false);
  });

  it("honeypot (website) BFF ตัดทิ้งก่อนส่ง — Backend ไม่รับฟิลด์นี้", () => {
    expect(ContactSchema.safeParse({ ...valid, website: "" }).success).toBe(true);
    expect(schema("ContactMessageRequest")({ ...valid, website: "" })).toBe(false);
  });
});

describe("บัญชีผู้ใช้", () => {
  it("MergeGuestRequest รับเฉพาะ id ของ Guest ที่ BFF สร้าง", () => {
    expect(schema("MergeGuestRequest")({ guestId: `guest-${globalThis.crypto.randomUUID()}` })).toBe(true);
    expect(schema("MergeGuestRequest")({ guestId: "google-12345" })).toBe(false);
  });

  it("User: name/email/image เป็น null ได้ (Guest)", () => {
    const at = "2026-10-10T06:00:00.000Z";
    expect(
      schema("User")({ id: "guest-1", provider: "guest", name: null, email: null, image: null, createdAt: at, updatedAt: at }),
    ).toBe(true);
  });
});
