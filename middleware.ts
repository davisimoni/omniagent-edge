import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/session';
import {
  checkRateLimit,
  policyForRequest,
  rateLimitHeaders,
  resolveIdentity,
} from '@/lib/rate-limit';

/**
 * Middleware di bordo: rate limiting e correlazione delle richieste.
 *
 * **Perché qui e non nelle rotte.** Un limite applicato dentro l'handler
 * protegge il modello ma non il resto: la richiesta ha già attraversato il
 * parsing del corpo, che su un allegato da cinque megabyte non è gratis. Il
 * middleware decide prima che il corpo venga letto, ed è l'unico punto in cui
 * una richiesta rifiutata costa davvero poco.
 *
 * **Perché solo su `/api`.** Il matcher esclude pagine e asset statici. Far
 * passare ogni richiesta di ogni immagine da un fetch a Redis aggiungerebbe una
 * andata e ritorno al percorso più sensibile alla latenza dell'applicazione, per
 * difendere risorse che non costano nulla.
 */
export const config = {
  matcher: ['/api/:path*'],
};

function requestId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  // La sola presenza del cookie basta: qui non si verifica la firma, si sceglie
  // quale budget applicare. Un cookie falsificato porta alla quota autenticata,
  // che la rotta rifiutera' comunque non trovando una sessione valida.
  const hasSession = request.cookies.has(SESSION_COOKIE);
  const policy = policyForRequest(request.nextUrl.pathname, hasSession);
  const correlationId = request.headers.get('x-request-id') ?? requestId();

  if (policy === null) {
    const response = NextResponse.next();
    response.headers.set('x-request-id', correlationId);
    return response;
  }

  const identity = resolveIdentity(request.headers);
  const decision = await checkRateLimit(identity, policy);
  const headers = { ...rateLimitHeaders(decision), 'x-request-id': correlationId };

  if (!decision.allowed) {
    // Il messaggio dice quanto aspettare e non perché è stato negato: chi sta
    // sondando i limiti non deve ricavarne la mappa, chi li ha superati in buona
    // fede ha bisogno solo del tempo di attesa.
    return NextResponse.json(
      {
        error: 'rate_limit_exceeded',
        message: `Troppe richieste. Riprova fra ${decision.retryAfterSeconds} secondi.`,
        retryAfterSeconds: decision.retryAfterSeconds,
      },
      { status: 429, headers },
    );
  }

  const response = NextResponse.next();
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}
