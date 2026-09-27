import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { env } from '../config/env';
import { AuthRequest } from '../middleware/auth.middleware';
import axios from 'axios';

export class SlackController {
  static async connect(req: AuthRequest, res: Response) {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const scope = 'chat:write,chat:write.public';
    const slackAuthUrl = `https://slack.com/oauth/v2/authorize?client_id=${env.SLACK_CLIENT_ID}&scope=${scope}&redirect_uri=${env.SLACK_REDIRECT_URI}&state=${req.user.userId}`;
    
    res.redirect(slackAuthUrl);
  }

  static async callback(req: Request, res: Response) {
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).json({ success: false, message: `Slack auth failed: ${error}` });
    }

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ success: false, message: 'Invalid code' });
    }

    if (!state || typeof state !== 'string') {
      return res.status(400).json({ success: false, message: 'Invalid state parameter' });
    }

    const userId = state; // We passed userId in state

    try {
      const response = await axios.post(
        'https://slack.com/api/oauth.v2.access',
        new URLSearchParams({
          client_id: env.SLACK_CLIENT_ID || '',
          client_secret: env.SLACK_CLIENT_SECRET || '',
          code,
          redirect_uri: env.SLACK_REDIRECT_URI,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      const data = response.data;

      if (!data.ok) {
        return res.status(400).json({ success: false, message: `Slack API error: ${data.error}` });
      }

      await prisma.slackConnection.upsert({
        where: { user_id: userId },
        update: {
          team_id: data.team.id,
          access_token: data.access_token,
          channel_id: data.incoming_webhook?.channel_id || '', // or any default channel if using bot token
          connected: true,
        },
        create: {
          user_id: userId,
          team_id: data.team.id,
          access_token: data.access_token,
          channel_id: data.incoming_webhook?.channel_id || '',
          connected: true,
        }
      });

      // Redirect back to frontend settings or dashboard
      res.redirect(`${env.FRONTEND_URL}?slack_connected=true`);

    } catch (error) {
      console.error('Slack OAuth error:', error);
      res.status(500).json({ success: false, message: 'OAuth processing failed' });
    }
  }

  static async status(req: AuthRequest, res: Response) {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
      const connection = await prisma.slackConnection.findUnique({
        where: { user_id: req.user.userId }
      });

      res.json({
        success: true,
        connected: !!connection?.connected
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async disconnect(req: AuthRequest, res: Response) {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
      await prisma.slackConnection.delete({
        where: { user_id: req.user.userId }
      });
      res.json({ success: true, message: 'Slack disconnected' });
    } catch (error) {
      // If it doesn't exist, it's fine
      res.json({ success: true, message: 'Slack disconnected' });
    }
  }
}
