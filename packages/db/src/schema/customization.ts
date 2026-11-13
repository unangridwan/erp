import { boolean, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { audit, tenantId } from "./core.js";

/** Definisi field kustom per model; nilainya di kolom jsonb `custom` tabel target. */
export const customFields = pgTable("custom_fields", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id"),
  model: text("model").notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  labelEn: text("label_en"),
  fieldType: text("field_type").notNull(),
  options: jsonb("options").$type<{ value: string; label: string }[]>().notNull().default([]),
  refModel: text("ref_model"),
  required: boolean("required").notNull().default(false),
  defaultValue: jsonb("default_value"),
  help: text("help"),
  section: text("section"),
  sequence: integer("sequence").notNull().default(0),
  showInList: boolean("show_in_list").notNull().default(false),
  showOnPdf: boolean("show_on_pdf").notNull().default(false),
  active: boolean("active").notNull().default(true),
  ...audit,
});
