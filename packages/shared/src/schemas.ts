import { z } from "zod";
import { CONSOLIDATION_METHODS, ENTITY_TYPES } from "./group.js";

const optionalText = z
  .string()
  .trim()
  .max(255)
  .nullish()
  .transform((v) => (v ? v : null));
const optionalUuid = z.string().uuid().nullish();
const money = z.union([z.number(), z.string().regex(/^-?\d+(\.\d{1,2})?$/)]).transform(String);
/** NPWP 16 digit (format baru) atau 15 digit (lama), tanda baca diabaikan. */
const npwp = z
  .string()
  .nullish()
  .transform((v) => (v ? v.replace(/[.\-\s]/g, "") : null))
  .refine((v) => v === null || /^\d{15,16}$/.test(v), "NPWP harus 15 atau 16 digit");

export const signupSchema = z.object({
  tenantSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "Slug 3-40 karakter: huruf kecil, angka, tanda hubung"),
  companyName: z.string().trim().min(2).max(200),
  name: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  tenantSlug: z.string().trim().toLowerCase().min(1),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const companySchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(200),
  parentId: optionalUuid,
  entityType: z.enum(ENTITY_TYPES).default("subsidiary"),
  npwp,
  currencyCode: z.string().length(3).toUpperCase().default("IDR"),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12).default(1),
  active: z.boolean().default(true),
});

export const ownershipSchema = z.object({
  parentCompanyId: z.string().uuid(),
  childCompanyId: z.string().uuid(),
  pct: z.coerce.number().gt(0).max(100).transform(String),
  method: z.enum(CONSOLIDATION_METHODS),
  validFrom: z.string().date(),
  validTo: z.string().date().nullish(),
});

export const businessUnitSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(200),
  active: z.boolean().default(true),
});

export const branchSchema = z.object({
  companyId: z.string().uuid(),
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(200),
  nitku: optionalText,
  active: z.boolean().default(true),
});

export const partnerSchema = z.object({
  companyId: optionalUuid,
  parentId: optionalUuid,
  kind: z.enum(["company", "person"]).default("company"),
  name: z.string().trim().min(1).max(200),
  isCustomer: z.boolean().default(false),
  isSupplier: z.boolean().default(false),
  npwp,
  email: z
    .string()
    .trim()
    .email()
    .nullish()
    .or(z.literal("").transform(() => null)),
  phone: optionalText,
  street: optionalText,
  city: optionalText,
  province: optionalText,
  postalCode: optionalText,
  active: z.boolean().default(true),
});

export const productCategorySchema = z.object({
  name: z.string().trim().min(1).max(200),
  parentId: optionalUuid,
});

export const uomSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().trim().min(1).max(50),
  factor: z.coerce.number().positive().transform(String),
  isReference: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const productSchema = z.object({
  companyId: optionalUuid,
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  productType: z.enum(["storable", "consumable", "service"]).default("storable"),
  categoryId: optionalUuid,
  uomId: z.string().uuid(),
  salePrice: money.default("0"),
  cost: money.default("0"),
  barcode: optionalText,
  active: z.boolean().default(true),
});

export const userCreateSchema = z.object({
  name: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
  roleIds: z.array(z.string().uuid()).default([]),
  companyIds: z.array(z.string().uuid()).min(1, "Pilih minimal satu perusahaan"),
});
