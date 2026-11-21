/**
 * Commande vocale française pour « Échecs Antiques 3D » (Web Speech API).
 * Reconnaît les commandes du type « C1 vers C3 », « E2 vers E4 », etc.
 */

const FILE_HOMOPHONES = {
  a: 'a',
  à: 'a',
  ah: 'a',
  ha: 'a',
  b: 'b',
  bé: 'b',
  be: 'b',
  bay: 'b',
  bée: 'b',
  c: 'c',
  cé: 'c',
  ce: 'c',
  se: 'c',
  ces: 'c',
  ses: 'c',
  "c'est": 'c',
  "s'est": 'c',
  cest: 'c',
  sait: 'c',
  d: 'd',
  dé: 'd',
  de: 'd',
  des: 'd',
  dès: 'd',
  day: 'd',
  e: 'e',
  eu: 'e',
  eux: 'e',
  euh: 'e',
  et: 'e',
  est: 'e',
  hé: 'e',
  f: 'f',
  ef: 'f',
  eff: 'f',
  effe: 'f',
  g: 'g',
  gé: 'g',
  ge: 'g',
  "j'ai": 'g',
  jai: 'g',
  jet: 'g',
  h: 'h',
  ache: 'h',
  hache: 'h',
  ash: 'h',
};

const RANK_HOMOPHONES = {
  '1': '1',
  un: '1',
  une: '1',
  hein: '1',
  '2': '2',
  deux: '2',
  deu: '2',
  '3': '3',
  trois: '3',
  troi: '3',
  '4': '4',
  quatre: '4',
  cat: '4',
  kat: '4',
  '5': '5',
  cinq: '5',
  saint: '5',
  sain: '5',
  '6': '6',
  six: '6',
  sis: '6',
  '7': '7',
  sept: '7',
  cet: '7',
  cette: '7',
  set: '7',
  '8': '8',
  huit: '8',
  hui: '8',
};

const PROMOTION_KEYWORDS = {
  dame: 'q',
  reine: 'q',
  tour: 'r',
  fou: 'b',
  cavalier: 'n',
  cheval: 'n',
};

const FILES = 'abcdefgh';

export function algebraicToSquare(alg) {
  if (typeof alg !== 'string' || alg.length !== 2) return null;
  const col = FILES.indexOf(alg[0].toLowerCase());
  const rank = Number(alg[1]);
  if (col < 0 || !Number.isInteger(rank) || rank < 1 || rank > 8) return null;
  return { row: 8 - rank, col };
}

/**
 * Extrait une commande d'échecs depuis une transcription vocale française.
 * Retourne :
 * - { type: 'move', from: { row, col, alg }, to: { row, col, alg }, promotion: string | null }
 * - { type: 'castle', side: 'k' | 'q' }
 * - null si aucune commande complète n'est reconnue
 */
export function parseVoiceChessCommand(rawTranscript) {
  if (typeof rawTranscript !== 'string' || !rawTranscript.trim()) return null;

  const lower = rawTranscript
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[-–—,.;:!?/()]/g, ' ')
    .replace(/\b([a-h])([1-8])([a-h])([1-8])\b/g, '$1 $2 $3 $4')
    .replace(/\b([a-h])([1-8])\b/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

  if (/\bpetit\s+roque\b/.test(lower)) {
    return { type: 'castle', side: 'k' };
  }
  if (/\bgrand\s+roque\b/.test(lower)) {
    return { type: 'castle', side: 'q' };
  }

  const tokens = lower.split(' ');
  const coords = [];
  let promotion = null;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (PROMOTION_KEYWORDS[tok]) {
      promotion = PROMOTION_KEYWORDS[tok];
    }

    const file = FILE_HOMOPHONES[tok];
    if (file && i + 1 < tokens.length) {
      const rank = RANK_HOMOPHONES[tokens[i + 1]];
      if (rank) {
        const alg = `${file}${rank}`;
        const sq = algebraicToSquare(alg);
        if (sq) {
          coords.push({ ...sq, alg });
          i += 1;
        }
      }
    }
  }

  if (coords.length >= 2) {
    return {
      type: 'move',
      from: coords[0],
      to: coords[1],
      promotion,
    };
  }

  return null;
}

/**
 * Contrôleur Web Speech API encapsulant la reconnaissance continue en français.
 */
export class VoiceChessController {
  constructor({ onStateChange, onInterim, onCommand, onError }) {
    this.onStateChange = onStateChange;
    this.onInterim = onInterim;
    this.onCommand = onCommand;
    this.onError = onError;

    const win = typeof window !== 'undefined' ? /** @type {any} */ (window) : null;
    const Ctor = win ? win.SpeechRecognition || win.webkitSpeechRecognition : null;
    this.SpeechRecognitionCtor = Ctor || null;
    this.recognition = null;
    this.isActive = false;
    this.lastFinalText = '';
    this.lastFinalTime = 0;
  }

  isSupported() {
    return Boolean(this.SpeechRecognitionCtor);
  }

  toggle() {
    if (this.isActive) {
      this.stop();
    } else {
      this.start();
    }
  }

  start() {
    if (!this.SpeechRecognitionCtor) {
      this.onError?.(
        "La reconnaissance vocale n'est pas prise en charge par ce navigateur (utilisez Chrome ou Edge)."
      );
      return;
    }
    if (this.isActive) return;

    this.isActive = true;
    this.onStateChange?.(true);
    this._createAndStart();
  }

  stop() {
    this.isActive = false;
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch (_) {}
      this.recognition = null;
    }
    this.onStateChange?.(false);
  }

  _createAndStart() {
    if (!this.isActive || !this.SpeechRecognitionCtor) return;

    const rec = new this.SpeechRecognitionCtor();
    rec.lang = 'fr-FR';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;

    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const primary = res[0]?.transcript?.trim() || '';
        if (!primary) continue;

        if (!res.isFinal) {
          this.onInterim?.(primary);
          continue;
        }

        const now = Date.now();
        if (primary === this.lastFinalText && now - this.lastFinalTime < 1200) {
          continue;
        }
        this.lastFinalText = primary;
        this.lastFinalTime = now;

        // Tester toutes les alternatives renvoyées par le moteur vocal
        let matched = null;
        let matchedText = primary;
        for (let alt = 0; alt < res.length; alt++) {
          const altText = res[alt]?.transcript?.trim() || '';
          const parsed = parseVoiceChessCommand(altText);
          if (parsed) {
            matched = parsed;
            matchedText = altText;
            break;
          }
        }

        this.onCommand?.(matched, matchedText);
      }
    };

    rec.onerror = (event) => {
      const code = event?.error;
      if (code === 'no-speech' || code === 'aborted') {
        return;
      }
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        this.isActive = false;
        this.recognition = null;
        this.onStateChange?.(false);
        this.onError?.("Accès au microphone refusé. Autorisez le micro dans votre navigateur.");
        return;
      }
      if (code === 'audio-capture') {
        this.isActive = false;
        this.recognition = null;
        this.onStateChange?.(false);
        this.onError?.('Aucun microphone détecté sur cet appareil.');
        return;
      }
      this.onError?.('Erreur de reconnaissance vocale. Nouvel essai...');
    };

    rec.onend = () => {
      if (this.isActive) {
        window.setTimeout(() => {
          if (this.isActive) this._createAndStart();
        }, 220);
      }
    };

    this.recognition = rec;
    try {
      rec.start();
    } catch (_) {
      this.isActive = false;
      this.recognition = null;
      this.onStateChange?.(false);
    }
  }
}
