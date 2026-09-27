import { Router } from 'express';
import { CampaignController } from '../controllers/campaign.controller';

const router = Router();

router.post('/', CampaignController.createCampaign);

export default router;
