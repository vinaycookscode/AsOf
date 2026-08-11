import type { FastifyInstance } from "fastify";
import { recordFeedback, type FeedbackAction } from "../../db/findings.js";

const VALID_ACTIONS: FeedbackAction[] = ["correct", "ignore", "snooze"];

interface FeedbackBody {
  action: string;
  personId?: string;
}

/** POST /api/findings/:id/feedback — correct/ignore/snooze actions (FR-7, B35). */
export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string }; Body: FeedbackBody }>("/api/findings/:id/feedback", async (request, reply) => {
    const { action, personId } = request.body ?? {};
    if (!VALID_ACTIONS.includes(action as FeedbackAction)) {
      return reply.code(400).send({ error: `action must be one of ${VALID_ACTIONS.join(", ")}` });
    }

    try {
      const result = await recordFeedback(request.params.id, action as FeedbackAction, personId);
      return result;
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
  });
}
