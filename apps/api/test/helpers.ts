import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module.js";

export const hasDb = Boolean(process.env.DATABASE_URL);

export async function createApp(): Promise<INestApplication> {
  const { migrate } = await import("@erp/db/migrate");
  await migrate(process.env.DATABASE_URL!);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

export const uniqueSlug = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

/** Daftarkan tenant baru dan kembalikan helper request ber-token. */
export async function signup(app: INestApplication, prefix = "t") {
  const slug = uniqueSlug(prefix);
  const res = await request(app.getHttpServer())
    .post("/auth/signup")
    .send({
      tenantSlug: slug,
      companyName: `PT ${slug}`,
      name: "Admin",
      email: "admin@example.com",
      password: "rahasia123",
    })
    .expect(201);
  return { slug, ...client(app, res.body.token as string) };
}

export function client(app: INestApplication, token: string, companyId?: string) {
  const withAuth = (req: request.Test) => {
    req.set("Authorization", `Bearer ${token}`);
    if (companyId) req.set("X-Company-Id", companyId);
    return req;
  };
  const server = app.getHttpServer();
  return {
    token,
    get: (url: string) => withAuth(request(server).get(url)),
    post: (url: string, body?: object) => withAuth(request(server).post(url)).send(body),
    patch: (url: string, body?: object) => withAuth(request(server).patch(url)).send(body),
    put: (url: string, body?: object) => withAuth(request(server).put(url)).send(body),
    delete: (url: string) => withAuth(request(server).delete(url)),
  };
}
