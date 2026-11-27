import { z } from "zod";

/**
 * Diskusi di dokumen: komentar pengguna dengan @mention. Disimpan di log aktivitas dokumen (`action: "message"`)
 * sehingga tampil berurutan bersama riwayat perubahan; yang disebut & pemilik dokumen mendapat notifikasi.
 */
export const commentSchema = z.object({
  message: z.string().trim().min(1, "Komentar wajib diisi").max(4000),
  mentions: z.array(z.string().uuid()).max(20).default([]),
});
export type CommentInput = z.infer<typeof commentSchema>;

/** Isi `changes` log aktivitas untuk komentar. */
export interface CommentMeta {
  mentions?: { id: string; name: string }[];
  /** Pengingat serah terima antar departemen. */
  reminder?: { process: string; stage: string };
  /** Eskalasi otomatis pengingat yang diabaikan ke atasan manajer departemen. */
  escalation?: { process: string; stage: string; to: { id: string; name: string }[] };
}

/**
 * Pecah teks komentar menjadi potongan biasa & sebutan (`@Nama` yang cocok dengan daftar yang disebut), untuk
 * ditampilkan dengan sorotan. Nama terpanjang dicocokkan lebih dulu.
 */
export function splitMentions(text: string, names: string[]): { text: string; mention: boolean }[] {
  const list = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!list.length) return [{ text, mention: false }];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`@(?:${list.map(esc).join("|")})`, "g");
  const out: { text: string; mention: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), mention: false });
    out.push({ text: m[0], mention: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), mention: false });
  return out;
}

/** Kata yang sedang diketik setelah `@` di posisi kursor (untuk saran nama), atau null. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([\p{L}\p{N}._' -]{0,30})$/u.exec(before);
  if (!m) return null;
  const query = m[2]!;
  // Spasi ganda atau akhiran spasi panjang: bukan lagi sebutan.
  if (/\s{2,}/.test(query)) return null;
  return { start: before.length - query.length - 1, query };
}
