import { describe, expect, it } from "vitest";
import { commentSchema, mentionQuery, splitMentions } from "./discussion.js";

describe("diskusi & @mention", () => {
  it("memecah teks menjadi sebutan & teks biasa (nama terpanjang dulu)", () => {
    expect(splitMentions("Tolong cek @Sari Dewi dan @Sari, terima kasih", ["Sari", "Sari Dewi"])).toEqual([
      { text: "Tolong cek ", mention: false },
      { text: "@Sari Dewi", mention: true },
      { text: " dan ", mention: false },
      { text: "@Sari", mention: true },
      { text: ", terima kasih", mention: false },
    ]);
    expect(splitMentions("tanpa sebutan", [])).toEqual([{ text: "tanpa sebutan", mention: false }]);
    // Karakter khusus regex pada nama aman.
    expect(splitMentions("@A.B (QC)", ["A.B (QC)"])).toEqual([{ text: "@A.B (QC)", mention: true }]);
  });

  it("mengenali kata setelah @ di posisi kursor", () => {
    expect(mentionQuery("Halo @Sa", 8)).toEqual({ start: 5, query: "Sa" });
    expect(mentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQuery("email a@b.com", 13)).toBeNull();
    expect(mentionQuery("Halo @Sari  lalu", 16)).toBeNull();
  });

  it("validasi komentar", () => {
    expect(commentSchema.safeParse({ message: "   " }).success).toBe(false);
    expect(commentSchema.parse({ message: " ok " })).toEqual({ message: "ok", mentions: [] });
  });
});
