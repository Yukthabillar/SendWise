import { prisma } from './src/config/db';
import { emailQueue } from './src/queues/email.queue';

async function testQueue() {
  // Ensure we have a mock user
  let user = await prisma.user.findFirst({ where: { email: 'test@example.com' } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        google_id: 'test-google-id',
        email: 'test@example.com',
        name: 'Test User',
      }
    });
  }

  // Create Campaign
  const campaign = await prisma.campaign.create({
    data: {
      user_id: user.id,
      subject: 'Test Rate Limit Queue',
      body: 'This is a test of the rate limit logic.',
      start_time: new Date(),
      delay_seconds: 2,
      hourly_limit: 2,
    }
  });

  const emails = ['rec1@example.com', 'rec2@example.com', 'rec3@example.com'];
  const startDateTime = Date.now();

  const emailRecords = await Promise.all(
    emails.map(async (recipient, index) => {
      return prisma.email.create({
        data: {
          campaign_id: campaign.id,
          user_id: user.id,
          recipient,
          subject: campaign.subject,
          body: campaign.body,
          scheduled_at: new Date(startDateTime + index * 2000),
          status: 'scheduled',
        }
      });
    })
  );

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

  console.log(`Scheduled 3 emails for campaign ${campaign.id}`);
  process.exit(0);
}

testQueue().catch(console.error);
