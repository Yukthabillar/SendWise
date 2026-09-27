import { prisma } from './src/config/db';

async function check() {
  const campaign = await prisma.campaign.findFirst({ 
    orderBy: { created_at: 'desc' },
    include: { emails: true }
  });
  console.log(JSON.stringify(campaign, null, 2));
  
  // also check bullmq queue state for the scheduled email
  const { emailQueue } = require('./src/queues/email.queue');
  const jobs = await emailQueue.getDelayed();
  console.log('Delayed jobs:', jobs.map((j: any) => ({ id: j.id, delay: j.opts.delay, timestamp: j.timestamp })));
  
  process.exit(0);
}
check();
