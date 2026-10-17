"use client";

import { apiRaw } from "../../lib/api";

/** Unduh berkas dari API (dengan token) sebagai file. */
export async function download(path: string, filename: string) {
  const res = await apiRaw(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? res.statusText);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
