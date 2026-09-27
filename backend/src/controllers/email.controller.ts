import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';
import { SearchService } from '../services/search.service';

export class EmailController {
  static async getScheduledEmails(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const userId = req.user.userId;

      const emails = await prisma.email.findMany({
        where: {
          user_id: userId,
          status: 'scheduled'
        },
        select: {
          id: true,
          recipient: true,
          subject: true,
          scheduled_at: true,
          status: true
        },
        orderBy: { scheduled_at: 'asc' }
      });

      res.json({
        emails: emails.map(e => ({
          id: e.id,
          recipient: e.recipient,
          subject: e.subject,
          scheduledAt: e.scheduled_at,
          status: e.status
        }))
      });
    } catch (error) {
      console.error('Get scheduled emails error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async getSentEmails(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const userId = req.user.userId;

      const emails = await prisma.email.findMany({
        where: {
          user_id: userId,
          status: 'sent'
        },
        select: {
          id: true,
          recipient: true,
          subject: true,
          sent_at: true,
          status: true
        },
        orderBy: { sent_at: 'desc' }
      });

      res.json({
        emails: emails.map(e => ({
          id: e.id,
          recipient: e.recipient,
          subject: e.subject,
          sentAt: e.sent_at,
          status: e.status
        }))
      });
    } catch (error) {
      console.error('Get sent emails error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async searchEmails(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const userId = req.user.userId;
      const { q } = req.query;

      if (!q || typeof q !== 'string') {
        return res.status(400).json({ success: false, message: 'Missing search query' });
      }

      const results = await SearchService.searchEmails(userId, q);
      res.json({ success: true, emails: results });
    } catch (error) {
      console.error('Search emails error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}
