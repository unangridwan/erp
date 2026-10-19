"use client";

import { apiRaw } from "./api";

/** Unduh berkas dari endpoint API (mis. XML Coretax hasil POST) dengan nama dari Content-Disposition. */
export async function download(path: string, body?: unknown, fallbackName = "berkas") {
  const res = await apiRaw(path, { method: body === undefined ? "GET" : "POST", body });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      message?: string;
      errors?: { message: string }[];
    };
    const details = data.errors?.map((e) => e.message).join("; ");
    throw new Error(
      details ? `${data.message ?? res.statusText}: ${details}` : (data.message ?? res.statusText),
    );
  }
  const name = res.headers.get("content-disposition")?.match(/filename="?([^";]+)"?/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Baca isi berkas yang dipilih pengguna sebagai teks. */
export const readFile = (file: File) => file.text();

/** Kelas badge per status dokumen pajak. */
export const taxStateClass = (state: string) =>
  ({
    draft: "state-draft",
    exported: "state-sent",
    approved: "state-posted",
    cancelled: "state-cancel",
    credited: "state-posted",
    not_credited: "state-cancel",
    new: "state-draft",
  })[state] ?? "state-draft";
