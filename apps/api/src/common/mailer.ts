import { Inject, Injectable } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import { CONFIG, type AppConfig } from "../config.js";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

@Injectable()
export class Mailer {
  private readonly transport: Transporter;
  /** Email terkirim saat MAIL_TRANSPORT=json (untuk test & pengembangan). */
  readonly outbox: Mail[] = [];

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    this.transport =
      config.mailTransport === "json"
        ? createTransport({ jsonTransport: true })
        : createTransport(config.mailTransport);
  }

  async send(mail: Mail) {
    await this.transport.sendMail({ from: this.config.mailFrom, ...mail });
    if (this.config.mailTransport === "json") this.outbox.push(mail);
  }
}
