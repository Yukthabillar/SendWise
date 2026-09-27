SELECT id, subject, status, created_at FROM "Campaign" ORDER BY created_at DESC LIMIT 5;
SELECT id, campaign_id, recipient, status, scheduled_at, sent_at, message_id FROM "Email" ORDER BY created_at DESC LIMIT 10;
