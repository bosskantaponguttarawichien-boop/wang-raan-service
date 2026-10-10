/**
 * ตัวตรวจสัญญา (feat-038) — ห่อ fetch แล้วตรวจทุก request/response เทียบกับ contracts/openapi.yaml
 * ใช้ในเทสต์ทั้งฝั่ง Backend จำลอง (response ตรงสัญญา) และฝั่ง BFF (request ตรงสัญญา)
 * ไม่โยน error ระหว่างทาง — เก็บรายการที่ผิดไว้ใน `violations` ให้เทสต์ตรวจตอนจบ
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { parse } from "yaml";

type Ref = { $ref: string };
interface MediaObject {
  schema?: unknown;
}
interface ResponseObject {
  content?: Record<string, MediaObject>;
  headers?: Record<string, { required?: boolean }>;
}
interface ParameterObject {
  name: string;
  in: "header" | "path" | "query";
  required?: boolean;
}
interface Operation {
  operationId: string;
  security?: unknown[];
  parameters?: Array<ParameterObject | Ref>;
  requestBody?: { required?: boolean; content: Record<string, MediaObject> };
  responses: Record<string, ResponseObject | Ref>;
}
interface Spec {
  paths: Record<string, Record<string, Operation> & { parameters?: Array<ParameterObject | Ref> }>;
  components: { responses: Record<string, ResponseObject>; parameters: Record<string, ParameterObject> };
}

const METHODS = ["get", "put", "post", "patch", "delete"] as const;

const spec = parse(readFileSync(resolve(__dirname, "openapi.yaml"), "utf8")) as Spec;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ ...spec, $id: "openapi" });

/** JSON Pointer → ส่วน fragment ของ URI (escape ~ / และอักขระที่ต้อง encode) */
const pointer = (segments: string[]) =>
  `openapi#/${segments.map((s) => encodeURIComponent(s.replace(/~/g, "~0").replace(/\//g, "~1"))).join("/")}`;

const validators = new Map<string, ValidateFunction>();
function validatorAt(segments: string[]): ValidateFunction {
  const key = pointer(segments);
  let v = validators.get(key);
  if (!v) {
    v = ajv.getSchema(key);
    if (!v) throw new Error(`ไม่พบ schema ที่ ${key}`);
    validators.set(key, v);
  }
  return v;
}

const isRef = (x: unknown): x is Ref => typeof x === "object" && x !== null && "$ref" in x;
const refName = (ref: string) => ref.split("/").pop()!;

interface Route {
  template: string;
  method: (typeof METHODS)[number];
  regex: RegExp;
  op: Operation;
  parameters: ParameterObject[];
}

const routes: Route[] = Object.entries(spec.paths).flatMap(([template, item]) =>
  METHODS.filter((m) => item[m]).map((method) => {
    const op = item[method]!;
    const parameters = [...(item.parameters ?? []), ...(op.parameters ?? [])].map((p) =>
      isRef(p) ? spec.components.parameters[refName(p.$ref)]! : p,
    );
    const regex = new RegExp(`^${template.replace(/\{[^}]+\}/g, "[^/]+")}$`);
    return { template, method, regex, op, parameters };
  }),
);

export function findOperation(method: string, pathname: string): Route | undefined {
  const m = method.toLowerCase();
  return routes.find((r) => r.method === m && r.regex.test(pathname));
}

export interface ContractViolation {
  operation: string;
  where: "request" | "response";
  message: string;
}

const describeErrors = (v: ValidateFunction) =>
  (v.errors ?? []).map((e) => `${e.instancePath || "(root)"} ${e.message ?? ""}`.trim()).join("; ");

/** ตรวจ request — คืนรายการจุดที่ผิดสัญญา */
export async function checkRequest(request: Request): Promise<ContractViolation[]> {
  const { pathname } = new URL(request.url);
  const route = findOperation(request.method, pathname);
  const label = `${request.method} ${pathname}`;
  if (!route) return [{ operation: label, where: "request", message: "ไม่มี operation นี้ในสัญญา" }];
  const out: ContractViolation[] = [];
  const add = (message: string) => out.push({ operation: route.op.operationId, where: "request", message });

  const needsToken = route.op.security === undefined;
  if (needsToken && !/^Bearer .+/.test(request.headers.get("authorization") ?? "")) add("ไม่มี Authorization: Bearer");
  for (const p of route.parameters) {
    if (p.in === "header" && p.required && !request.headers.get(p.name)) add(`ไม่มี header ${p.name}`);
  }

  const body = request.body ? await request.clone().text() : "";
  if (route.op.requestBody) {
    if (!body) {
      if (route.op.requestBody.required) add("ไม่มี body");
    } else {
      if (!(request.headers.get("content-type") ?? "").includes("application/json")) add("content-type ไม่ใช่ application/json");
      const v = validatorAt(["paths", route.template, route.method, "requestBody", "content", "application/json", "schema"]);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        add("body ไม่ใช่ JSON");
      }
      if (parsed !== undefined && !v(parsed)) add(`body ผิด schema: ${describeErrors(v)}`);
    }
  } else if (body) {
    add("operation นี้ไม่รับ body");
  }
  return out;
}

/** ตรวจ response ของ request นั้น — สถานะต้องอยู่ในสัญญา และ body ต้องตรง schema */
export async function checkResponse(request: Request, response: Response): Promise<ContractViolation[]> {
  const { pathname } = new URL(request.url);
  const route = findOperation(request.method, pathname);
  if (!route) return [];
  const out: ContractViolation[] = [];
  const add = (message: string) => out.push({ operation: route.op.operationId, where: "response", message });
  const status = String(response.status);
  const range = `${status[0]}XX`;
  const declared = route.op.responses[status] ?? route.op.responses[range];
  if (!declared) {
    add(`สถานะ ${status} ไม่อยู่ในสัญญา (มี ${Object.keys(route.op.responses).join(", ")})`);
    return out;
  }
  const [segments, resolved] = isRef(declared)
    ? [["components", "responses", refName(declared.$ref)], spec.components.responses[refName(declared.$ref)]!]
    : [["paths", route.template, route.method, "responses", route.op.responses[status] ? status : range], declared];

  for (const [name, header] of Object.entries(resolved.headers ?? {})) {
    if (header.required && !response.headers.get(name)) add(`สถานะ ${status} ต้องมี header ${name}`);
  }
  const text = await response.clone().text();
  if (!resolved.content) {
    if (text) add(`สถานะ ${status} ต้องไม่มี body`);
    return out;
  }
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) add(`สถานะ ${status} content-type ไม่ใช่ JSON`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    add(`สถานะ ${status} body ไม่ใช่ JSON`);
    return out;
  }
  const v = validatorAt([...segments, "content", "application/json", "schema"]);
  if (!v(parsed)) add(`สถานะ ${status} body ผิด schema: ${describeErrors(v)}`);
  return out;
}

/**
 * ห่อ fetch handler ให้ตรวจสัญญาทุกครั้ง: `const checked = contractFetch(mock.fetch)` แล้วส่ง `checked.fetch` ให้ BFF
 * ตอนจบเทสต์: `expect(checked.violations).toEqual([])`
 */
export function contractFetch(inner: (request: Request) => Promise<Response> | Response, options: { requests?: boolean } = {}) {
  const violations: ContractViolation[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request && !init ? input : new Request(input, init);
    // requests: false — เทสต์ที่ตั้งใจส่งคำขอผิดสัญญา (ตรวจแค่ว่า response ยังตรงสัญญา)
    if (options.requests !== false) violations.push(...(await checkRequest(request)));
    const response = await inner(request.clone());
    violations.push(...(await checkResponse(request, response)));
    return response;
  };
  return { fetch: fetchImpl as typeof fetch, violations };
}
