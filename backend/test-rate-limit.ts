import { prisma } from './src/config/db';
import { RateLimitService } from './src/services/rateLimit.service';
import { emailQueue } from './src/queues/email.queue';
import { redisConnection } from './src/config/redis';

async function testRateLimit() {
  console.log('Testing rate limit service logic...');
  const senderId = 'test-sender-123';
  const limit = 2;

  // Clear previous Redis keys for this sender
  const currentHour = new Date();
  currentHour.setMinutes(0, 0, 0);
  const windowKey = `email-rate:${senderId}:${currentHour.getTime()}`;
  await redisConnection.del(windowKey);

  let res1 = await RateLimitService.checkAndIncrement(senderId, limit);
  console.log('Req 1:', res1); // Expected: allowed: true, justThrottled: false

  let res2 = await RateLimitService.checkAndIncrement(senderId, limit);
  console.log('Req 2:', res2); // Expected: allowed: true, justThrottled: true

  let res3 = await RateLimitService.checkAndIncrement(senderId, limit);
  console.log('Req 3:', res3); // Expected: allowed: false, justThrottled: false

  if (res1.allowed && res2.allowed && !res3.allowed) {
    console.log('✅ Rate limiting logic works perfectly!');
  } else {
    console.error('❌ Rate limiting logic failed!');
  }

  process.exit(0);
}

testRateLimit().catch(console.error);
