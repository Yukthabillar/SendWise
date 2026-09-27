import { redisConnection } from '../config/redis';

export class RateLimitService {
  /**
   * Checks if the sender has exceeded their hourly limit.
   * If not, increments the counter.
   * Returns true if allowed, false if rate limited.
   */
  static async checkAndIncrement(senderId: string, limit: number): Promise<{ allowed: boolean; justThrottled: boolean }> {
    const currentHour = new Date();
    currentHour.setMinutes(0, 0, 0);
    const windowKey = `email-rate:${senderId}:${currentHour.getTime()}`;

    // Use a Lua script to atomically check and increment
    // Returns: 1 if allowed, 0 if already throttled, 2 if THIS request hit the limit
    const luaScript = `
      local current = redis.call("GET", KEYS[1])
      if current and tonumber(current) >= tonumber(ARGV[1]) then
        return 0 -- already at or exceeded limit
      end
      
      local new_val = redis.call("INCR", KEYS[1])
      if new_val == 1 then
        redis.call("EXPIRE", KEYS[1], 3600)
      end
      
      if new_val == tonumber(ARGV[1]) then
        return 2 -- just reached the limit
      end
      
      return 1 -- allowed
    `;

    const result = await redisConnection.eval(luaScript, 1, windowKey, limit);
    return {
      allowed: result === 1 || result === 2,
      justThrottled: result === 2,
    };
  }
}
