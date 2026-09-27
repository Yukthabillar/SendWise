import axios from 'axios';
import { prisma } from '../config/db';

export class SlackService {
  static async notifyRateLimitHit(userId: string, senderId: string, limit: number) {
    try {
      const connection = await prisma.slackConnection.findUnique({
        where: { user_id: userId }
      });

      if (!connection || !connection.connected || !connection.access_token) {
        return; // Slack not connected, silently skip
      }

      const message = `⚠️ *Rate Limit Reached*\nSender \`${senderId}\` has reached the hourly limit of ${limit} emails. Sending will resume next hour.`;

      await axios.post(
        'https://slack.com/api/chat.postMessage',
        {
          channel: connection.channel_id,
          text: message,
        },
        {
          headers: {
            'Authorization': `Bearer ${connection.access_token}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      console.error('Failed to send Slack notification:', error);
      // Do not throw, this is a non-critical side effect
    }
  }
}
