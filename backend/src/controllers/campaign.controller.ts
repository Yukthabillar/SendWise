import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { emailQueue } from '../queues/email.queue';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth.middleware';

const createCampaignSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Body is required'),
  startTime: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid startTime'),
  delaySeconds: z.number().min(0, 'Delay must be positive'),
  hourlyLimit: z.number().positive('Hourly limit must be positive'),
  emails: z.array(z.string().email('Invalid email address')).min(1, 'At least one email required')
});

import { env } from '../config/env';

export class CampaignController {
  static async createCampaign(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const parsed = createCampaignSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ 
          success: false, 
          message: parsed.error.errors[0].message 
        });
      }

      const { subject, body, startTime, delaySeconds, hourlyLimit, emails } = parsed.data;
      
      if (delaySeconds * 1000 < env.MIN_EMAIL_DELAY_MS) {
        return res.status(400).json({
          success: false,
          message: `Delay must be at least ${env.MIN_EMAIL_DELAY_MS / 1000} seconds`
        });
      }

      const userId = req.user.userId;

      // Create Campaign
      const campaign = await prisma.campaign.create({
        data: {
          user_id: userId,
          subject,
          body,
          start_time: new Date(startTime),
          delay_seconds: delaySeconds,
          hourly_limit: hourlyLimit,
        }
      });

      // Deduplicate emails
      const uniqueEmails = [...new Set(emails)];
      const startDateTime = new Date(startTime).getTime();

      // Create emails in bulk
      const emailRecords = await Promise.all(
        uniqueEmails.map(async (recipient, index) => {
          return prisma.email.create({
            data: {
              campaign_id: campaign.id,
              user_id: userId,
              recipient,
              subject,
              body,
              scheduled_at: new Date(startDateTime + index * delaySeconds * 1000),
              status: 'scheduled',
            }
          });
        })
      );

      // Enqueue Jobs
      await Promise.all(
        emailRecords.map((email) => {
          const delay = Math.max(0, email.scheduled_at.getTime() - Date.now());
          return emailQueue.add(
            'send-email',
            { emailId: email.id, campaignId: campaign.id },
            { delay, jobId: email.id }
          );
        })
      );

      res.status(201).json({
        success: true,
        campaignId: campaign.id,
        emailsScheduled: emailRecords.length
      });

    } catch (error) {
      console.error('Create campaign error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}
