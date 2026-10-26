"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";

interface Result {
  action: "in" | "out";
  employeeName: string;
  at: string;
}

/**
 * Mode kiosk (tablet di kantor): pindai/ketik kode badge (scanner barcode bekerja seperti keyboard), masukkan PIN,
 * foto opsional dari kamera. Pesan sukses tampil beberapa detik lalu layar kembali siap.
 */
export default function KioskPage() {
  const { l, locale } = useI18n();
  const codeRef = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [camera, setCamera] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!result && !error) return;
    const t = setTimeout(() => {
      setResult(null);
      setError(null);
      codeRef.current?.focus();
    }, 4000);
    return () => clearTimeout(t);
  }, [result, error]);
  useEffect(() => {
    if (!camera) return;
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user" } })
      .then((s) => {
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setCamera(false));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [camera]);

  function snapshot() {
    const v = video.current;
    if (!camera || !v || !v.videoWidth) return null;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 640 / v.videoWidth);
    canvas.width = v.videoWidth * scale;
    canvas.height = v.videoHeight * scale;
    canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
    return { type: "image/jpeg", data: canvas.toDataURL("image/jpeg", 0.7).split(",")[1] ?? "" };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setResult(
        await api<Result>("/attendance/kiosk", { method: "POST", body: { code, pin, photo: snapshot() } }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : String(err));
    } finally {
      setCode("");
      setPin("");
    }
  }
  const press = (d: string) => setPin((p) => (d === "⌫" ? p.slice(0, -1) : p.length < 8 ? p + d : p));
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", opts).format(d);

  return (
    <div className="kiosk">
      <div className="kiosk-clock">
        <strong>{fmt(now, { timeStyle: "medium" })}</strong>
        <span>{fmt(now, { dateStyle: "full" })}</span>
      </div>
      {result ? (
        <div className={`kiosk-result ${result.action}`}>
          <h1>
            {result.action === "in" ? l("Selamat bekerja", "Have a good day") : l("Sampai jumpa", "See you")},{" "}
            {result.employeeName}
          </h1>
          <p>
            {result.action === "in" ? l("Absen masuk", "Checked in") : l("Absen pulang", "Checked out")}{" "}
            {fmt(new Date(result.at), { timeStyle: "short" })}
          </p>
        </div>
      ) : (
        <form className="kiosk-form" onSubmit={submit}>
          <label className="field">
            <span>{l("Kode badge / No. karyawan", "Badge code / employee no.")}</span>
            <input
              ref={codeRef}
              autoFocus
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>PIN</span>
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
            />
          </label>
          <div className="kiosk-keypad">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0"].map((d) => (
              <button key={d} type="button" onClick={() => press(d)}>
                {d}
              </button>
            ))}
            <button type="submit" className="primary">
              OK
            </button>
          </div>
          {error && <p className="error">{error}</p>}
          <label className="check">
            <input type="checkbox" checked={camera} onChange={(e) => setCamera(e.target.checked)} />
            {l("Ambil foto saat absen", "Take a photo on punch")}
          </label>
          {camera && <video ref={video} autoPlay playsInline muted className="kiosk-video" />}
        </form>
      )}
    </div>
  );
}
