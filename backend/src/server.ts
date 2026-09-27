import app from './app';
import { env } from './config/env';
import './workers/email.worker'; // Import worker to start it
import { SearchService } from './services/search.service';

const PORT = env.PORT || 5000;

app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  await SearchService.initializeIndex();
});
