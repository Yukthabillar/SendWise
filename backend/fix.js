const { PrismaClient } = require('@prisma/client');
const { Queue } = require('bullmq');
const Redis = require('ioredis');

const prisma = new PrismaClient();
const redis = new Redis('redis://localhost:6379');
const emailQueue = new Queue('email-queue', { connection: redis });

async function fix() {
  const emailId = 'b2f489ab-9492-4928-895b-adfe87f0327f';
  const email = await prisma.email.findUnique({ where: { id: emailId } });
  
  if (email) {
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    const delay = nextHour.getTime() - Date.now();

    await prisma.email.update({
      where: { id: emailId },
      data: { scheduled_at: nextHour }
    });
    
    await emailQueue.add(
      'send-email',
      { emailId, campaignId: email.campaign_id, senderId: email.sender_id },
      { delay, jobId: `${emailId}-retry-${Date.now()}` }
    );
    console.log('Fixed email job:', emailId);
  }
  process.exit(0);
}

fix().catch(console.error);
