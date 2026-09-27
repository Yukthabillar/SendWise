import nodemailer from 'nodemailer';
import { env } from '../config/env';

export class EmailService {
  private static transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD,
    },
  });

  static async sendEmail(to: string, subject: string, text: string, senderEmail?: string) {
    const from = senderEmail || '"SendWise Default Sender" <default@ethereal.email>';
    
    // Create a local transporter if a specific sender isn't provided (for the default system env)
    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASSWORD,
      },
    });

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
    });

    return {
      messageId: info.messageId,
      previewUrl: nodemailer.getTestMessageUrl(info),
    };
  }
}
