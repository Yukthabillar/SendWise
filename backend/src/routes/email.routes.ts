import { Router } from 'express';
import { EmailController } from '../controllers/email.controller';

const router = Router();

router.get('/scheduled', EmailController.getScheduledEmails);
router.get('/sent', EmailController.getSentEmails);
router.get('/search', EmailController.searchEmails);

export default router;
