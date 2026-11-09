import { Router } from 'express';
import { agentRouter } from './agent';
import { aiRouter } from './ai';
import { computerRouter } from './computer';
import { conversationsRouter } from './conversations';
import { connectorsRouter } from './connectors';
import { eventsRouter } from './events';
import { healthRouter } from './health';
import { knowledgeRouter } from './knowledge';
import { memoryRouter } from './memory';
import { permissionsRouter } from './permissions';
import { providerRouter } from './provider';
import { voiceRouter } from './voice';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/ai', aiRouter);
apiRouter.use('/agent', agentRouter);
apiRouter.use('/computer', computerRouter);
apiRouter.use('/events', eventsRouter);
apiRouter.use('/conversations', conversationsRouter);
apiRouter.use('/knowledge', knowledgeRouter);
apiRouter.use('/memory', memoryRouter);
apiRouter.use('/connectors', connectorsRouter);
apiRouter.use('/provider', providerRouter);
apiRouter.use('/voice', voiceRouter);
apiRouter.use('/permissions', permissionsRouter);
