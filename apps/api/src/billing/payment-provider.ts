import type { AppConfig } from "../config.js";

export interface PaymentRequest {
  invoiceId: string;
  number: string;
  amount: string;
  description: string;
  payerEmail: string | null;
  returnUrl: string;
}

export interface PaymentLink {
  provider: string;
  providerRef: string | null;
  paymentUrl: string | null;
  instructions: string | null;
}

/** Penyedia pembayaran tagihan langganan. */
export interface PaymentProvider {
  readonly name: string;
  create(request: PaymentRequest): Promise<PaymentLink>;
}

/** Transfer bank manual: admin platform menandai lunas setelah bukti transfer diterima. */
export class ManualProvider implements PaymentProvider {
  readonly name = "manual";
  constructor(private readonly instructions: string) {}
  async create(request: PaymentRequest): Promise<PaymentLink> {
    return {
      provider: this.name,
      providerRef: null,
      paymentUrl: null,
      instructions: `${this.instructions}\nCantumkan nomor tagihan ${request.number} pada berita transfer.`,
    };
  }
}

/** Xendit Invoice API (VA, QRIS, e-wallet, kartu). Status lunas datang lewat webhook. */
export class XenditProvider implements PaymentProvider {
  readonly name = "xendit";
  constructor(
    private readonly secretKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async create(request: PaymentRequest): Promise<PaymentLink> {
    const res = await this.fetchFn("https://api.xendit.co/v2/invoices", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        external_id: request.invoiceId,
        amount: Number(request.amount),
        currency: "IDR",
        description: request.description,
        payer_email: request.payerEmail ?? undefined,
        success_redirect_url: request.returnUrl,
        failure_redirect_url: request.returnUrl,
      }),
    });
    if (!res.ok) throw new Error(`Xendit menolak permintaan (${res.status})`);
    const body = (await res.json()) as { id: string; invoice_url: string };
    return { provider: this.name, providerRef: body.id, paymentUrl: body.invoice_url, instructions: null };
  }
}

export function paymentProvider(config: AppConfig): PaymentProvider {
  return config.billing.xenditSecretKey
    ? new XenditProvider(config.billing.xenditSecretKey)
    : new ManualProvider(config.billing.bankInfo);
}
