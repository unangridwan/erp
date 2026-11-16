import { boolean, integer, numeric, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { audit, tenantId } from "./core.js";

export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const TICKET_STATUSES = ["new", "open", "pending", "resolved", "closed"] as const;
export const TICKET_CHANNELS = ["email", "portal", "phone", "web", "chat", "other"] as const;
export const TICKET_MESSAGE_KINDS = ["public", "internal", "customer"] as const;

/** Antrean layanan (tim agen). */
export const supportTeams = pgTable("support_teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  leaderId: uuid("leader_id"),
  memberIds: uuid("member_ids").array().notNull().default([]),
  autoAssign: boolean("auto_assign").notNull().default(true),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const supportSlaPolicies = pgTable("support_sla_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  priority: text("priority", { enum: TICKET_PRIORITIES }).notNull(),
  teamId: uuid("team_id"),
  firstResponseHours: numeric("first_response_hours", { precision: 8, scale: 2 }).notNull(),
  resolutionHours: numeric("resolution_hours", { precision: 8, scale: 2 }).notNull(),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const supportTickets = pgTable("support_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  number: text("number").notNull(),
  subject: text("subject").notNull(),
  description: text("description"),
  partnerId: uuid("partner_id"),
  contactId: uuid("contact_id"),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  channel: text("channel", { enum: TICKET_CHANNELS }).notNull().default("phone"),
  category: text("category"),
  priority: text("priority", { enum: TICKET_PRIORITIES }).notNull().default("normal"),
  status: text("status", { enum: TICKET_STATUSES }).notNull().default("new"),
  teamId: uuid("team_id"),
  userId: uuid("user_id"),
  leadId: uuid("lead_id"),
  slaPolicyId: uuid("sla_policy_id"),
  firstResponseDue: timestamp("first_response_due", { withTimezone: true }),
  resolveDue: timestamp("resolve_due", { withTimezone: true }),
  firstRespondedAt: timestamp("first_responded_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  firstResponseBreached: boolean("first_response_breached").notNull().default(false),
  resolutionBreached: boolean("resolution_breached").notNull().default(false),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  satisfaction: smallint("satisfaction"),
  satisfactionNote: text("satisfaction_note"),
  createdBy: uuid("created_by"),
  ...audit,
});

export const supportTicketMessages = pgTable("support_ticket_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  ticketId: uuid("ticket_id").notNull(),
  kind: text("kind", { enum: TICKET_MESSAGE_KINDS }).notNull(),
  body: text("body").notNull(),
  authorUserId: uuid("author_user_id"),
  authorName: text("author_name"),
  createdAt: audit.createdAt,
});

export const supportArticles = pgTable("support_articles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  title: text("title").notNull(),
  category: text("category"),
  body: text("body").notNull(),
  published: boolean("published").notNull().default(false),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  views: integer("views").notNull().default(0),
  createdBy: uuid("created_by"),
  ...audit,
});

export const supportSettings = pgTable("support_settings", {
  companyId: uuid("company_id").primaryKey(),
  tenantId: tenantId(),
  inboundKeyHash: text("inbound_key_hash"),
  defaultTeamId: uuid("default_team_id"),
  autoCloseDays: integer("auto_close_days").notNull().default(7),
  updatedAt: audit.updatedAt,
});
