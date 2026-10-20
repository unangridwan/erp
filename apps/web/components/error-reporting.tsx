"use client";

import { useEffect } from "react";
import { initErrorReporting } from "../lib/error-reporting";

/** Memasang pelaporan error browser sekali di root layout (tanpa DSN tidak melakukan apa pun). */
export function ErrorReporting() {
  useEffect(() => initErrorReporting(), []);
  return null;
}
