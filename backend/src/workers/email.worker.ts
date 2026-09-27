import { Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { emailQueueName, emailQueue } from '../queues/email.queue';
import { prisma } from '../config/db';
import { RateLimitService } from '../services/rateLimit.service';
import { EmailService } from '../services/email.service';
import { SearchService } from '../services/search.service';
import { SlackService } from '../services/slack.service';
import { env } from '../config/env';

interface EmailJobData {
  emailId: string;
  campaignId: string;
  senderId?: string;
}

export const emailWorker = new Worker<EmailJobData>(
  emailQueueName,
  async (job: Job<EmailJobData>) => {
    const { emailId, senderId } = job.data;

    const email = await prisma.email.findUnique({
      where: { id: emailId },
      include: { campaign: true, sender: true }
    });

    if (!email) {
      console.error(`Email record not found for job ${job.id}`);
      return;
    }

    if (email.status === 'sent') {
      console.log(`Email ${emailId} already sent. Skipping.`);
      return; // Idempotent check
    }

    const hourlyLimit = email.campaign?.hourly_limit || email.sender?.hourly_limit || env.MAX_EMAILS_PER_HOUR;
    const sId = senderId || 'default-sender';

    const { allowed, justThrottled } = await RateLimitService.checkAndIncrement(sId, hourlyLimit);

    if (justThrottled) {
       await SlackService.notifyRateLimitHit(email.user_id, sId, hourlyLimit);
    }

    if (!allowed) {
      console.log(`Rate limit reached for sender ${sId}. Rescheduling email ${emailId}.`);
      
      // Calculate delay to next hour while preserving original delay spacing
      // Instead of snapping to the start of the hour (which causes all jobs to fire concurrently),
      // we add exactly 1 hour (3600000 ms) to the original scheduled_at time.
      let nextHour = new Date(email.scheduled_at.getTime() + 60 * 60 * 1000);
      
      // If adding 1 hour still leaves it in the past, keep bumping it to the next future hour
      while (nextHour.getTime() <= Date.now()) {
        nextHour = new Date(nextHour.getTime() + 60 * 60 * 1000);
      }

      const delay = nextHour.getTime() - Date.now();

      // Update the database to reflect the new scheduled time
      await prisma.email.update({
        where: { id: emailId },
        data: { scheduled_at: nextHour }
      });

      await emailQueue.add(
        'send-email',
        { emailId, campaignId: email.campaign_id, senderId },
        { delay, jobId: `${emailId}-retry-${Date.now()}` }
      );
      
      return;
    }

    // Set processing status
    await prisma.email.update({
      where: { id: emailId },
      data: { status: 'processing', attempts: { increment: 1 } }
    });

    try {
      const sendResult = await EmailService.sendEmail(
        email.recipient,
        email.subject,
        email.body,
        email.sender?.email
      );

      console.log(`Sent email to ${email.recipient}. Preview URL: ${sendResult.previewUrl}`);

      const sentEmail = await prisma.email.update({
        where: { id: emailId },
        data: {
          status: 'sent',
          sent_at: new Date(),
          message_id: sendResult.messageId,
        }
      });

      await SearchService.indexEmail(sentEmail);

    } catch (error: any) {
      console.error(`Failed to send email ${emailId}:`, error);

      await prisma.email.update({
        where: { id: emailId },
        data: {
          status: 'failed',
          error_message: error.message || 'Unknown error'
        }
      });

      throw error; // Let BullMQ handle retries
    }
  },
  {
    connection: redisConnection,
    concurrency: env.WORKER_CONCURRENCY,
  }
);
