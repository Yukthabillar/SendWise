import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { emailQueue } from './queues/email.queue';
import campaignRoutes from './routes/campaign.routes';
import emailRoutes from './routes/email.routes';
import authRoutes from './routes/auth.routes';
import slackRoutes from './routes/slack.routes';
import { authMiddleware } from './middleware/auth.middleware';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Set up Bull Board
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter: serverAdapter,
});

app.use('/admin/queues', serverAdapter.getRouter());

// Routes

app.use('/api/auth', authRoutes);
app.use('/api/slack', slackRoutes);
app.use('/api/campaigns', authMiddleware, campaignRoutes);
app.use('/api/emails', authMiddleware, emailRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

export default app;
