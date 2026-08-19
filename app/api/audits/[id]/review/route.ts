import { z } from 'zod';
import { getCurrentAccount } from '@/lib/auth/current-user';
import { listMembers } from '@/lib/auth/repository';
import { assignReview, getAudit, setReviewOutcome } from '@/lib/audits/repository';
import { hasFeature } from '@/lib/billing/plans';

export const runtime = 'edge';
export const preferredRegion = ['fra1'];
export const dynamic = 'force-dynamic';

const reviewSchema = z.object({
  assigneeId: z.string().min(1).max(64).nullable().optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * Assegnazione e chiusura di una revisione.
 *
 * **L'assegnatario viene verificato contro i membri del workspace.** Senza
 * questo controllo, un id arbitrario nel corpo assegnerebbe l'audit a un utente
 * di un'altra organizzazione, che poi se lo vedrebbe comparire fra i propri
 * incarichi — con dentro il contratto di qualcun altro. Il vincolo di chiave
 * esterna sul database garantisce che l'utente esista, non che appartenga a
 * questo workspace: sono due cose diverse.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (account === null) {
    return json(401, { error: 'unauthenticated', message: 'Accedi per gestire le revisioni.' });
  }

  if (!hasFeature(account.organization.plan, 'reviewAssignment')) {
    return json(402, {
      error: 'feature_not_in_plan',
      message: 'L\'assegnazione a un revisore è inclusa dal piano Pro.',
      requiredPlan: 'pro',
    });
  }

  const { id } = await context.params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { error: 'invalid_json', message: 'Il corpo non è JSON valido.' });
  }

  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success) {
    return json(400, { error: 'invalid_request', message: 'Payload non valido.' });
  }

  try {
    const existing = await getAudit(account.organization.id, id);
    if (existing === null) {
      return json(404, { error: 'not_found', message: 'Audit non trovato in questo workspace.' });
    }

    if (parsed.data.assigneeId !== undefined) {
      if (parsed.data.assigneeId !== null) {
        const members = await listMembers(account.organization.id);
        if (!members.some((member) => member.id === parsed.data.assigneeId)) {
          return json(400, {
            error: 'invalid_assignee',
            message: 'La persona indicata non fa parte di questo workspace.',
          });
        }
      }
      await assignReview(account.organization.id, id, parsed.data.assigneeId);
    }

    if (parsed.data.status !== undefined) {
      await setReviewOutcome(
        account.organization.id,
        id,
        parsed.data.status,
        parsed.data.notes ?? null,
      );
    }

    return json(200, { ok: true });
  } catch (error) {
    console.error('[audits/review] errore', error);
    return json(500, { error: 'review_failed', message: 'Aggiornamento non riuscito.' });
  }
}
