import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import nodemailer from 'nodemailer';

// ============================================================================
// 1. CONFIGURATION & CHEMINS SÉCURISÉS
// ============================================================================

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

const DATA_DIR = path.resolve(process.cwd(), 'data');
const USERS_FILE = path.resolve(DATA_DIR, 'users.json');

if (!USERS_FILE.startsWith(DATA_DIR + path.sep)) {
  throw new Error('Chemin de stockage invalide.');
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ============================================================================
// 2. CONFIGURATION SMTP POUR RÉINITIALISATION DE MOT DE PASSE
// ============================================================================

export function isSmtpConfigured() {
  const host = (process.env.SMTP_HOST || '').trim();
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();
  return Boolean(host && user && pass);
}

/**
 * @param {import('express').Request} req
 * @param {number} defaultPort
 */
function getSafeResetBaseUrl(req, defaultPort) {
  const configured = (process.env.APP_URL || '').trim();
  if (configured && configured !== 'MY_APP_URL') {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin;
      }
    } catch {
      // Ignorer un APP_URL invalide et valider l'en-tête Host ci-dessous
    }
  }

  const forwardedHost = (req.get('x-forwarded-host') || '').split(',')[0].trim();
  const rawHost = forwardedHost || req.get('host') || `localhost:${defaultPort}`;
  const safeHost = /^[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(rawHost)
    ? rawHost
    : `localhost:${defaultPort}`;
  const forwardedProto = (req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
  const proto = forwardedProto === 'https' || req.protocol === 'https' ? 'https' : 'http';
  return `${proto}://${safeHost}`;
}

/**
 * @param {string} value
 */
function escapeHtmlAttribute(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * @param {string} toEmail
 * @param {string} resetUrl
 */
async function sendPasswordResetEmail(toEmail, resetUrl) {
  const host = (process.env.SMTP_HOST || '').trim();
  const user = (process.env.SMTP_USER || '').trim();
  let pass = (process.env.SMTP_PASS || '').trim();
  const rawFrom = (process.env.SMTP_FROM || '').trim();

  // Les mots de passe d'application Gmail sont souvent copiés par groupes de 4 lettres avec espaces
  if (host.toLowerCase().includes('gmail') && /^[a-zA-Z]{4}(?:\s+[a-zA-Z]{4}){3}$/.test(pass)) {
    pass = pass.replace(/\s+/g, '');
  }

  const port = Number(process.env.SMTP_PORT) || 587;
  // Port 587 utilise STARTTLS (secure: false), port 465 utilise TLS implicite (secure: true)
  const secure = port === 465 || (process.env.SMTP_SECURE === 'true' && port !== 587);

  const rawSender = rawFrom || (user.includes('@') ? user : '');
  if (!rawSender) {
    const cfgErr = /** @type {any} */ (new Error('Adresse expéditeur SMTP_FROM manquante.'));
    cfgErr.code = 'INVALID_SMTP_FROM';
    throw cfgErr;
  }
  const fromAddress = rawSender.includes('<') ? rawSender : `Échecs Antiques 3D <${rawSender}>`;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: port === 587,
    connectionTimeout: 12000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    auth: {
      user,
      pass,
    },
  });

  const subject = 'Échecs Antiques 3D — Réinitialisation de votre mot de passe';

  const text = [
    'Bonjour,',
    '',
    'Vous avez demandé à modifier votre mot de passe sur Échecs Antiques 3D.',
    'Cliquez sur le lien ci-dessous (valable 15 minutes) pour définir un nouveau mot de passe :',
    '',
    resetUrl,
    '',
    "Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet e-mail.",
  ].join('\n');

  const safeHref = escapeHtmlAttribute(resetUrl);
  const html = `
    <div style="font-family: Georgia, serif; background:#0F0D0B; color:#F9F7F2; padding:28px; border:1px solid #D4AF37; max-width:540px;">
      <h2 style="color:#F3E5AB; margin-top:0;">Échecs Antiques 3D</h2>
      <p style="line-height:1.6; color:#E5DDD0;">
        Vous avez demandé à modifier le mot de passe associé à votre compte.
      </p>
      <p style="margin:24px 0;">
        <a href="${safeHref}" style="display:inline-block; padding:12px 20px; background:#D4AF37; color:#120F0C; font-weight:bold; text-decoration:none; border-radius:6px;">
          Modifier mon mot de passe
        </a>
      </p>
      <p style="font-size:13px; color:#B8AE9F; line-height:1.5;">
        Ce lien est valable pendant 15 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail.
      </p>
    </div>
  `;

  const info = await transporter.sendMail({
    from: fromAddress,
    to: toEmail,
    subject,
    text,
    html,
  });

  if (
    (Array.isArray(info.rejected) && info.rejected.length > 0) ||
    (Array.isArray(info.accepted) && info.accepted.length === 0)
  ) {
    const rejErr = /** @type {any} */ (
      new Error(`Destinataire refusé par le serveur SMTP (${(info.rejected || []).join(', ')}).`)
    );
    rejErr.code = 'SMTP_REJECTED';
    throw rejErr;
  }
}

// ============================================================================
// 3. STOCKAGE PERSISTANT ATOMIQUE (FICHIER JSON SUR VPS)
// ============================================================================

let writeQueue = Promise.resolve();

async function ensureDataDir() {
  await fsp.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
}

/**
 * @returns {Promise<any[]>}
 */
async function loadUsers() {
  await ensureDataDir();
  try {
    const raw = await fsp.readFile(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (/** @type {any} */ (err)?.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * @param {(users: any[]) => Promise<void> | void} mutator
 */
function saveUsersSerialized(mutator) {
  const next = writeQueue.then(async () => {
    const users = await loadUsers();
    await mutator(users);
    const tmpFile = path.resolve(DATA_DIR, `.users.${crypto.randomUUID()}.tmp`);
    if (!tmpFile.startsWith(DATA_DIR + path.sep)) {
      throw new Error('Chemin temporaire invalide.');
    }
    await fsp.writeFile(tmpFile, JSON.stringify(users, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fsp.rename(tmpFile, USERS_FILE);
  });
  writeQueue = next.catch(() => {});
  return next;
}

/**
 * @param {any} u
 */
function toPublicUser(u) {
  return {
    id: u.id,
    email: u.email,
    createdAt: u.createdAt,
    stats: u.stats || { wins: 0, losses: 0, draws: 0 },
  };
}

// ============================================================================
// 4. HACHAGE SCRYPT & JETONS DE SESSION SIGNÉS (HMAC-SHA256)
// ============================================================================

/**
 * @param {string} password
 * @returns {Promise<string>}
 */
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

/**
 * @param {string} password
 * @param {string} storedHash
 * @returns {Promise<boolean>}
 */
function verifyPassword(password, storedHash) {
  return new Promise((resolve, reject) => {
    const parts = storedHash.split(':');
    if (parts.length !== 2) return resolve(false);
    const [salt, keyHex] = parts;
    if (!salt || !keyHex) return resolve(false);
    const expectedBuf = Buffer.from(keyHex, 'hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      if (derivedKey.length !== expectedBuf.length) return resolve(false);
      resolve(crypto.timingSafeEqual(derivedKey, expectedBuf));
    });
  });
}

/**
 * @param {string} rawToken
 */
function hashResetToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

const revokedSessionIds = new Map();

/**
 * @param {{ uid: string, email: string, sid: string, iat: number, exp: number }} payload
 */
function signToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

/**
 * @param {string} token
 */
function verifyToken(token) {
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;
  const encoded = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!encoded || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed.uid !== 'string' || typeof parsed.sid !== 'string') return null;
    if (typeof parsed.exp !== 'number' || parsed.exp <= Date.now()) return null;
    if (revokedSessionIds.has(parsed.sid)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ============================================================================
// 5. LIMITATION DE DÉBIT ANTI FORCE BRUTE & MIDDLEWARE D'AUTHENTIFICATION
// ============================================================================

const authRateBuckets = new Map();

/**
 * @param {string} value
 */
function isValidEmail(value) {
  return value.length >= 5 && value.length <= 160 && EMAIL_REGEX.test(value);
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function authRateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || 'unknown';
  const entry = authRateBuckets.get(key);
  if (!entry || entry.resetAt <= now) {
    authRateBuckets.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return next();
  }
  if (entry.count >= 25) {
    res.status(429).json({
      error: 'Trop de tentatives. Veuillez patienter quelques minutes avant de réessayer.',
    });
    return;
  }
  entry.count += 1;
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of authRateBuckets.entries()) {
    if (v.resetAt <= now) authRateBuckets.delete(k);
  }
  for (const [sid, exp] of revokedSessionIds.entries()) {
    if (exp <= now) revokedSessionIds.delete(sid);
  }
}, 10 * 60 * 1000).unref();

/**
 * @param {any} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentification requise.' });
      return;
    }
    const token = header.slice('Bearer '.length).trim();
    const payload = verifyToken(token);
    if (!payload) {
      res.status(401).json({ error: 'Session expirée ou invalide.' });
      return;
    }

    const users = await loadUsers();
    const user = users.find((u) => u.id === payload.uid);
    if (!user) {
      res.status(401).json({ error: 'Compte introuvable.' });
      return;
    }
    if (user.passwordChangedAt && payload.iat < user.passwordChangedAt) {
      res.status(401).json({ error: 'Session expirée suite à un changement de mot de passe.' });
      return;
    }

    req.authUser = user;
    req.authSession = payload;
    next();
  } catch (err) {
    console.error('Erreur vérification session:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

// ============================================================================
// 6. ROUTEUR EXPRESS /api/auth/*
// ============================================================================

/**
 * Crée le routeur Express gérant l'inscription, la connexion, la récupération
 * de mot de passe par SMTP, le profil et les statistiques joueur.
 * @param {{ defaultPort?: number }} [options]
 */
export function createAuthRouter(options = {}) {
  const defaultPort = Number(options.defaultPort) || 3000;
  const router = express.Router();

  router.get('/config', (_req, res) => {
    res.json({ smtpConfigured: isSmtpConfigured() });
  });

  router.post('/register', authRateLimit, async (req, res) => {
    try {
      const rawEmail = req.body?.email;
      const rawPassword = req.body?.password;

      if (typeof rawEmail !== 'string' || typeof rawPassword !== 'string') {
        res.status(400).json({ error: 'Adresse e-mail et mot de passe requis.' });
        return;
      }

      const email = rawEmail.trim();
      if (!isValidEmail(email)) {
        res.status(400).json({ error: 'Veuillez saisir une adresse e-mail valide.' });
        return;
      }

      if (rawPassword.length < 6 || rawPassword.length > 128) {
        res.status(400).json({
          error: 'Le mot de passe doit contenir entre 6 et 128 caractères.',
        });
        return;
      }

      const emailLower = email.toLowerCase();
      const passwordHash = await hashPassword(rawPassword);
      /** @type {any} */
      let createdUser = null;

      await saveUsersSerialized((users) => {
        if (users.some((u) => u.emailLower === emailLower)) {
          throw new Error('DUPLICATE_EMAIL');
        }
        createdUser = {
          id: crypto.randomUUID(),
          email,
          emailLower,
          passwordHash,
          createdAt: new Date().toISOString(),
          stats: { wins: 0, losses: 0, draws: 0 },
        };
        users.push(createdUser);
      });

      if (!createdUser) {
        res.status(500).json({ error: 'Impossible de créer le compte.' });
        return;
      }

      const now = Date.now();
      const token = signToken({
        uid: createdUser.id,
        email: createdUser.email,
        sid: crypto.randomUUID(),
        iat: now,
        exp: now + SESSION_TTL_MS,
      });

      res.status(201).json({
        token,
        user: toPublicUser(createdUser),
      });
    } catch (err) {
      if (/** @type {Error} */ (err)?.message === 'DUPLICATE_EMAIL') {
        res.status(409).json({ error: 'Un compte existe déjà avec cette adresse e-mail.' });
        return;
      }
      console.error('Erreur inscription:', err);
      res.status(500).json({ error: "Erreur serveur lors de l'inscription." });
    }
  });

  router.post('/login', authRateLimit, async (req, res) => {
    try {
      const rawEmail = req.body?.email;
      const rawPassword = req.body?.password;

      if (typeof rawEmail !== 'string' || typeof rawPassword !== 'string') {
        res.status(400).json({ error: 'Adresse e-mail et mot de passe requis.' });
        return;
      }

      const emailLower = rawEmail.trim().toLowerCase();
      if (!isValidEmail(emailLower) || rawPassword.length === 0 || rawPassword.length > 128) {
        res.status(401).json({ error: 'Adresse e-mail ou mot de passe incorrect.' });
        return;
      }

      const users = await loadUsers();
      const user = users.find((u) => u.emailLower === emailLower);
      if (!user) {
        res.status(401).json({ error: 'Adresse e-mail ou mot de passe incorrect.' });
        return;
      }

      const valid = await verifyPassword(rawPassword, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: 'Adresse e-mail ou mot de passe incorrect.' });
        return;
      }

      const now = Date.now();
      const token = signToken({
        uid: user.id,
        email: user.email,
        sid: crypto.randomUUID(),
        iat: now,
        exp: now + SESSION_TTL_MS,
      });

      res.json({
        token,
        user: toPublicUser(user),
      });
    } catch (err) {
      console.error('Erreur connexion:', err);
      res.status(500).json({ error: 'Erreur serveur lors de la connexion.' });
    }
  });

  router.post('/forgot-password', authRateLimit, async (req, res) => {
    try {
      const rawEmail = req.body?.email;
      if (typeof rawEmail !== 'string' || !isValidEmail(rawEmail.trim())) {
        res.status(400).json({ error: 'Veuillez saisir une adresse e-mail valide.' });
        return;
      }

      if (!isSmtpConfigured()) {
        console.warn(
          'Demande de réinitialisation refusée : SMTP non configuré (SMTP_HOST/SMTP_USER/SMTP_PASS manquants).'
        );
        res.status(503).json({
          error:
            "L'envoi d'e-mails (SMTP) n'est pas encore configuré sur ce serveur. Renseignez SMTP_HOST, SMTP_USER, SMTP_PASS et SMTP_FROM dans le fichier .env puis redémarrez le serveur.",
        });
        return;
      }

      const emailLower = rawEmail.trim().toLowerCase();
      /** @type {string | null} */
      let targetEmail = null;
      /** @type {string | null} */
      let rawResetToken = null;

      await saveUsersSerialized((users) => {
        const user = users.find((u) => u.emailLower === emailLower);
        if (!user) return;
        rawResetToken = crypto.randomBytes(32).toString('base64url');
        user.resetTokenHash = hashResetToken(rawResetToken);
        user.resetTokenExpiresAt = Date.now() + RESET_TOKEN_TTL_MS;
        targetEmail = user.email;
      });

      if (!targetEmail || !rawResetToken) {
        res.status(404).json({
          error:
            "Aucun compte n'est enregistré avec cette adresse e-mail sur ce serveur. Vérifiez l'adresse ou créez un compte via « Inscription ».",
        });
        return;
      }

      const baseUrl = getSafeResetBaseUrl(req, defaultPort);
      const resetUrl = `${baseUrl}/?resetToken=${encodeURIComponent(rawResetToken)}`;

      try {
        await sendPasswordResetEmail(targetEmail, resetUrl);
      } catch (mailErr) {
        // Annuler le jeton si l'envoi SMTP a échoué
        await saveUsersSerialized((users) => {
          const user = users.find((u) => u.emailLower === emailLower);
          if (user) {
            delete user.resetTokenHash;
            delete user.resetTokenExpiresAt;
          }
        }).catch(() => {});

        const code = /** @type {any} */ (mailErr)?.code || '';
        const respCode = /** @type {any} */ (mailErr)?.responseCode;
        console.error('Échec envoi e-mail SMTP:', code, respCode, mailErr);

        if (code === 'EAUTH' || respCode === 535 || respCode === 534) {
          res.status(502).json({
            error:
              "Authentification SMTP refusée par le serveur mail. Vérifiez SMTP_USER et SMTP_PASS (avec Gmail, un « mot de passe d'application » à 16 caractères est obligatoire).",
          });
          return;
        }
        if (code === 'INVALID_SMTP_FROM') {
          res.status(502).json({
            error:
              "Adresse d'expéditeur invalide : définissez une adresse e-mail valide dans SMTP_FROM.",
          });
          return;
        }
        if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ESOCKET') {
          res.status(502).json({
            error:
              'Impossible de joindre le serveur SMTP (vérifiez SMTP_HOST, SMTP_PORT 587/465 et que le pare-feu du VPS autorise les connexions sortantes).',
          });
          return;
        }
        res.status(502).json({
          error: "Le serveur SMTP a refusé ou n'a pas pu délivrer l'e-mail. Vérifiez les journaux du serveur.",
        });
        return;
      }

      res.json({
        ok: true,
        message:
          "Un e-mail contenant le lien de réinitialisation vient d'être envoyé. Pensez aussi à vérifier votre dossier Spam / Indésirables.",
      });
    } catch (err) {
      console.error('Erreur mot de passe oublié:', err);
      res.status(500).json({
        error: "Impossible d'envoyer l'e-mail de réinitialisation pour le moment.",
      });
    }
  });

  router.post('/reset-password', authRateLimit, async (req, res) => {
    try {
      const rawToken = req.body?.token;
      const rawPassword = req.body?.newPassword;

      if (typeof rawToken !== 'string' || rawToken.length < 20 || rawToken.length > 200) {
        res.status(400).json({ error: 'Lien de réinitialisation invalide ou expiré.' });
        return;
      }

      if (typeof rawPassword !== 'string' || rawPassword.length < 6 || rawPassword.length > 128) {
        res.status(400).json({
          error: 'Le nouveau mot de passe doit contenir entre 6 et 128 caractères.',
        });
        return;
      }

      const candidateHashBuf = Buffer.from(hashResetToken(rawToken), 'hex');
      const newPasswordHash = await hashPassword(rawPassword);
      let updated = false;

      await saveUsersSerialized((users) => {
        const now = Date.now();
        const match = users.find((u) => {
          if (!u.resetTokenHash || !u.resetTokenExpiresAt || u.resetTokenExpiresAt <= now) {
            return false;
          }
          const storedBuf = Buffer.from(u.resetTokenHash, 'hex');
          return (
            storedBuf.length === candidateHashBuf.length &&
            crypto.timingSafeEqual(storedBuf, candidateHashBuf)
          );
        });

        if (!match) return;
        match.passwordHash = newPasswordHash;
        match.passwordChangedAt = now;
        delete match.resetTokenHash;
        delete match.resetTokenExpiresAt;
        updated = true;
      });

      if (!updated) {
        res.status(400).json({ error: 'Lien de réinitialisation invalide ou expiré.' });
        return;
      }

      res.json({
        ok: true,
        message: 'Votre mot de passe a été modifié avec succès. Vous pouvez vous connecter.',
      });
    } catch (err) {
      console.error('Erreur réinitialisation mot de passe:', err);
      res.status(500).json({ error: 'Erreur serveur lors de la réinitialisation.' });
    }
  });

  router.post('/logout', requireAuth, (/** @type {any} */ req, res) => {
    if (req.authSession) {
      revokedSessionIds.set(req.authSession.sid, req.authSession.exp);
    }
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, (/** @type {any} */ req, res) => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Non connecté.' });
      return;
    }
    res.json({ user: toPublicUser(req.authUser) });
  });

  router.post('/stats', requireAuth, async (/** @type {any} */ req, res) => {
    try {
      const result = req.body?.result;
      if (result !== 'win' && result !== 'loss' && result !== 'draw') {
        res.status(400).json({ error: 'Résultat invalide.' });
        return;
      }
      const userId = req.authUser?.id;
      if (!userId) {
        res.status(401).json({ error: 'Authentification requise.' });
        return;
      }

      /** @type {any} */
      let updatedUser = null;
      await saveUsersSerialized((users) => {
        const target = users.find((u) => u.id === userId);
        if (!target) return;
        if (!target.stats) target.stats = { wins: 0, losses: 0, draws: 0 };
        if (result === 'win') target.stats.wins += 1;
        else if (result === 'loss') target.stats.losses += 1;
        else target.stats.draws += 1;
        updatedUser = target;
      });

      if (!updatedUser) {
        res.status(404).json({ error: 'Compte introuvable.' });
        return;
      }

      res.json({ user: toPublicUser(updatedUser) });
    } catch (err) {
      console.error('Erreur mise à jour stats:', err);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  });

  return router;
}
