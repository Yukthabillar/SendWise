import { Router } from 'express';
import { SlackController } from '../controllers/slack.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.get('/connect', authMiddleware, SlackController.connect);
router.get('/callback', SlackController.callback);
router.get('/status', authMiddleware, SlackController.status);
router.delete('/disconnect', authMiddleware, SlackController.disconnect);

export default router;
