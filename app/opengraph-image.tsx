import { ImageResponse } from 'next/og';

/**
 * Immagine di anteprima per la condivisione.
 *
 * Generata da codice invece che da un file statico: il marchio, il gradiente e
 * la frase di posizionamento vivono già nel repository, e mantenerne una copia
 * in un PNG significa che il giorno in cui cambiano l'anteprima continua a
 * mostrare la versione vecchia — visibile a tutti tranne che a chi la modifica.
 *
 * Niente font personalizzati: caricarne uno richiederebbe una fetch in fase di
 * build, cioè una dipendenza di rete per produrre un'immagine. I font di
 * sistema di Satori bastano per tre righe di testo.
 */
export const runtime = 'edge';
export const alt =
  'OmniAgent Edge — audit automatico dei contratti fornitori, con citazione del testo fonte';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0f1117',
          padding: 72,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {/* Stessa geometria del marchio, con i colori scritti a mano: qui non
              esiste un documento da cui leggere le variabili del tema. */}
          <svg width="72" height="72" viewBox="0 0 32 32" fill="none">
            <defs>
              <linearGradient id="og-mark" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
                <stop stopColor="#818cf8" />
                <stop offset="0.52" stopColor="#38bdf8" />
                <stop offset="1" stopColor="#34d399" />
              </linearGradient>
            </defs>
            <path
              d="M16 1.8 27.8 8.1V17c0 6.9-5.2 11.8-11.8 13.9C9.4 28.8 4.2 23.9 4.2 17V8.1L16 1.8Z"
              fill="url(#og-mark)"
            />
            <path
              d="M10.6 16.4 14.4 20.2 21.6 12.6"
              stroke="#0f1117"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="21.6" cy="12.6" r="2" fill="#0f1117" />
          </svg>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
            <span style={{ fontSize: 44, fontWeight: 700, color: '#f5f5f7', letterSpacing: -1 }}>
              OmniAgent
            </span>
            <span
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: '#34d399',
                letterSpacing: 4,
                border: '2px solid #34d399',
                borderRadius: 8,
                padding: '4px 10px',
              }}
            >
              EDGE
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <span style={{ fontSize: 62, fontWeight: 700, color: '#f5f5f7', lineHeight: 1.1, letterSpacing: -2 }}>
            Scopri che cosa hai firmato,
          </span>
          <span style={{ fontSize: 62, fontWeight: 700, color: '#34d399', lineHeight: 1.1, letterSpacing: -2 }}>
            prima di firmarlo di nuovo.
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 26, color: '#9ca3af' }}>
            Rilievi GDPR e ISO 27001, penali, SLA — ognuno con la citazione del contratto.
          </span>
        </div>
      </div>
    ),
    size,
  );
}
