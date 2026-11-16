import { describe, expect, it } from "vitest";
import {
  assignmentRuleSchema,
  campaignError,
  campaignRoi,
  campaignSchema,
  pickAssignmentRule,
  scoreGrade,
  scoreLead,
  scoringRuleSchema,
  webFormError,
  webFormSchema,
  webFormSubmissionSchema,
} from "./crm-marketing.js";

const c = (field: string, op: string, value = "") => ({ field, op: op as "eq", value });

describe("crm marketing", () => {
  it("skor lead: jumlah aturan yang cocok, dibatasi 0–100", () => {
    const rules = [
      { conditions: [c("source", "eq", "referral")], points: 30 },
      { conditions: [c("employeeCount", "gte", "100")], points: 25 },
      { conditions: [c("email", "notEmpty")], points: 10 },
      { conditions: [c("email", "contains", "@gmail.com")], points: -15 },
      { conditions: [c("industry", "in", "Perkebunan, Pertanian"), c("province", "eq", "riau")], points: 40 },
      { conditions: [c("source", "eq", "referral")], points: 90, active: false },
      { conditions: [], points: 99 },
    ];
    expect(scoreLead({ source: "referral", employeeCount: 250, email: "a@pt.co.id" }, rules)).toBe(65);
    expect(scoreLead({ source: "ads", email: "x@gmail.com" }, rules)).toBe(0);
    expect(
      scoreLead(
        { source: "referral", employeeCount: 500, email: "a@b.id", industry: "perkebunan", province: "Riau" },
        rules,
      ),
    ).toBe(100);
    expect(scoreLead({}, [])).toBe(0);
    expect([80, 75, 50, 49, 25, 0].map(scoreGrade)).toEqual(["A", "A", "B", "C", "C", "D"]);
  });

  it("aturan penugasan: urutan terkecil yang cocok; tanpa syarat = semua", () => {
    const rules = [
      { id: "umum", sequence: 99, conditions: [] },
      { id: "jabar", sequence: 5, conditions: [c("province", "eq", "Jawa Barat")] },
      { id: "besar", sequence: 1, conditions: [c("employeeCount", "gt", "1000")] },
      { id: "mati", sequence: 0, conditions: [], active: false },
    ];
    expect(pickAssignmentRule(rules, { province: "jawa barat", employeeCount: 5000 })?.id).toBe("besar");
    expect(pickAssignmentRule(rules, { province: "jawa barat" })?.id).toBe("jabar");
    expect(pickAssignmentRule(rules, { province: "Bali" })?.id).toBe("umum");
    expect(pickAssignmentRule([], {})).toBeNull();
  });

  it("ROI kampanye & biaya per lead", () => {
    expect(campaignRoi({ cost: "10000000", wonAmount: "45000000", leads: 20 })).toEqual({
      roi: 350,
      costPerLead: "500000.00",
    });
    expect(campaignRoi({ cost: "10000000", wonAmount: "0", leads: 0 })).toEqual({
      roi: -100,
      costPerLead: null,
    });
    expect(campaignRoi({ cost: 0, wonAmount: "5000", leads: 3 })).toEqual({ roi: null, costPerLead: null });
  });

  it("skema kampanye, aturan, dan formulir", () => {
    expect(campaignError({ dateStart: "2026-11-10", dateEnd: "2026-11-01" })?.[0]).toBe("dateEnd");
    expect(campaignError({ dateStart: "2026-11-10" })).toBeNull();
    expect(campaignSchema.parse({ name: "Pameran" })).toMatchObject({ campaignType: "email", budget: "0" });
    expect(scoringRuleSchema.safeParse({ name: "x", conditions: [], points: 10 }).success).toBe(false);
    expect(
      scoringRuleSchema.safeParse({ name: "x", conditions: [c("rahasia", "eq", "1")], points: 10 }).success,
    ).toBe(false);
    expect(assignmentRuleSchema.safeParse({ name: "x", userIds: [] }).success).toBe(false);
    expect(webFormSchema.parse({ name: "Kontak" })).toMatchObject({
      fields: ["contactName", "partnerName", "email", "phone", "description"],
      requiredFields: ["contactName", "email"],
    });
    expect(webFormError({ fields: ["contactName"], requiredFields: [] })?.[0]).toBe("fields");
    expect(webFormError({ fields: ["email"], requiredFields: ["phone"] })?.[0]).toBe("requiredFields");
    expect(webFormError({ fields: ["email", "contactName"], requiredFields: ["email"] })).toBeNull();
    expect(webFormSchema.safeParse({ name: "x", redirectUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(webFormSubmissionSchema.parse({ contactName: " Sari ", email: "", phone: "" })).toMatchObject({
      contactName: "Sari",
      email: null,
      phone: null,
    });
    expect(webFormSubmissionSchema.safeParse({ email: "bukan-email" }).success).toBe(false);
  });
});
