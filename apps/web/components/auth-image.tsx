"use client";

import { useEffect, useState } from "react";
import { apiRaw } from "../lib/api";

/** URL objek per path API; `bump(path)` setelah unggah agar gambar dimuat ulang. */
const cache = new Map<string, Promise<string | null>>();
const listeners = new Set<() => void>();

export function bumpImage(path: string) {
  const old = cache.get(path);
  cache.delete(path);
  void old?.then((url) => url && URL.revokeObjectURL(url));
  for (const l of listeners) l();
}

function load(path: string) {
  let entry = cache.get(path);
  if (!entry) {
    entry = apiRaw(path)
      .then(async (res) => (res.ok ? URL.createObjectURL(await res.blob()) : null))
      .catch(() => null);
    cache.set(path, entry);
  }
  return entry;
}

/** Gambar dari API yang butuh token (foto karyawan, pratinjau kartu identitas). */
export function AuthImage({
  path,
  alt,
  className,
  fallback = null,
}: {
  path: string;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  useEffect(() => {
    let alive = true;
    void load(path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path, tick]);
  if (!url) return <>{fallback}</>;
  return <img src={url} alt={alt} className={className} />;
}
